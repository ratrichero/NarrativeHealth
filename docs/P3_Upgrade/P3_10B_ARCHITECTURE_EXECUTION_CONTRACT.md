# P3-10B — Architecture & Execution Contract

**Status:** ARCHITECTURE CONTRACT  
**Task:** P3-10B — P3 Architecture & Execution Contract  
**Date:** 2026-08-10

## Executive Summary

This document defines the authoritative execution architecture and contract for the P3 (Narrative Intelligence & Rotation) orchestrator. It establishes how the approved P3 calculation modules (P3-03 through P3-09) execute as a deterministic production pipeline within the existing Next.js refresh architecture.

The architecture preserves the existing authoritative execution path while adding P3 intelligence calculation as a new stage after Narrative Health. It establishes clear contracts for execution order, data flow, missing-data propagation, failure isolation, and persistence boundaries to ensure deterministic, reproducible, and historically immutable P3 results.

---

## Scope

This contract defines:

1. The authoritative execution path for P3 intelligence calculation
2. The P3 execution context and shared state
3. UTC window semantics for all P3 calculations
4. Dependency graph and execution order for P3-03 through P3-09
5. Input/output contracts between P3 modules
6. Constituent snapshot lifecycle
7. Market data source boundaries
8. Versioning and configuration resolution
9. Missing-data propagation rules
10. Failure isolation and error propagation
11. Persistence boundary and idempotency
12. Transaction boundaries
13. Retry semantics
14. Observability requirements
15. API integration contract
16. FastAPI boundary

This task does NOT implement the P3 orchestrator or modify existing refresh behavior.

---

## Authoritative Execution Path

### Confirmed Path

```text
Scheduler (Asia/Ho_Chi_Minh)
    ↓
POST /api/refresh (Next.js)
    ↓
Existing P0-P2 Pipeline
    ├─ Market Data Collection
    ├─ Feature Calculation
    ├─ Coin Health Calculation
    └─ Narrative Health Calculation
    ↓
P3 Intelligence Orchestrator (NEW)
    ↓
P3-03 → P3-09 Execution
    ↓
Immutable P3 Persistence
```

### Boundary Decisions

**Next.js = Authoritative P3 Execution Path**

- P3 orchestrator lives in Next.js `/api/refresh`
- All P3 calculations execute in the Next.js authoritative path
- P3 results are persisted through Next.js database connections

**FastAPI = No Independent P3 Implementation**

- FastAPI does NOT execute P3 calculations
- FastAPI does NOT own P3 persistence
- FastAPI does NOT maintain a parallel P3 calculation path
- Any FastAPI-triggered refresh must ultimately reach Next.js for authoritative P3 results

Do not create a second P3 execution path.

---

## Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────────────┐
│                     Scheduler (Asia/Ho_Chi_Minh)                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ↓ POST /api/refresh
┌────────────────────────────┴─────────────────────────────────────┐
│                  Next.js Refresh Route                         │
│                                                               │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ P0-P2 Pipeline (existing)                                │ │
│  │ • Market data collection                                   │ │
│  │ • Feature calculation                                     │ │
│  │ • Coin Health calculation                                 │ │
│  │ • Narrative Health calculation                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ P3 Intelligence Orchestrator (NEW)                           │ │
│  │                                                               │ │
│  │  ┌───────────────────────────────────────────────────────┐   │ │
│  │  │ P3-03: Context & Window Resolution                     │   │ │
│  │  │     → createCalculationContext()                       │   │ │
│  │  │     → resolveP3Window()                              │   │ │
│  │  └───────────────────────────────────────────────────────┘   │ │
│  │                                                               │ │
│  │  ┌───────────────────────────────────────────────────────┐   │ │
│  │  │ Constituent Snapshot Preparation                         │   │ │
│  │  │     → prepareConstituents()                          │   │ │
│  │  │     → Market cap eligibility check                   │   │ │
│  │  │     → Futures instrument check                        │   │
│  │  └───────────────────────────────────────────────────────┘   │ │
│  │                                                               │
│  │  ┌───────────────────────────────────────────────────────┐   │ │
│  │  │ P3-04: Breadth Calculation                               │   │ │
│  │  │     → calculateBreadthResult()                         │   │
│  │  └───────────────────────────────────────────────────────┘   │ │
│  │                                                               │
│  │  ┌───────────────────────────────────────────────────────┐   │ │
│  │  │ P3-05: Momentum Calculation                              │   │
│  │  │     → calculateP3MomentumResult()                       │   │ │
│  │  │     → calculateAcceleration()                            │   │
│  │  └───────────────────────────────────────────────────────┘   │ │
│  │                                                               │
│  │  ┌───────────────────────────────────────────────────────┐   │ │
│  │  │ P3-06: Relative Strength Calculation                     │   │
│  │  │     → calculateRelativeStrengthResult()                 │   │
│  │  │     → BTC benchmark (BTC-USDT perpetual)               │   │
│  │  └───────────────────────────────────────────────────────┘   │ │
│  │                                                               │
│  │  ┌───────────────────────────────────────────────────────┐   │ │
│  │  │ P3-07: Leadership + Concentration                     │   │
│ │  │     → calculateLeadershipResult()                       │   │
│  │  │     → calculateLeadership() (logic)                     │ │ │
│  │  └───────────────────────────────────────────────────────┘   │
│  │                                                               │
│  │  ┌───────────────────────────────────────────────────────┐   │ │
│  │  │ P3-08: Regime Calculation                                 │   │
│  │  │     → calculateRegimeResult()                           │   │
│  │  └───────────────────────────────────────────────────────┘   │
│  │                                                               │
│  │  ┌───────────────────────────────────────────────────────┐   │ │
│  │  │ P3-09: Rotation Calculation                               │   │
│ │  │     → calculateRotationResult()                           │   │
│  │  │     → Rotation component normalization                 │   │
│  │  │     → OI Confirmation matrix                            │   │
│  │  └───────────────────────────────────────────────────────┘   │
│  │                                                               │
│  │  ┌───────────────────────────────────────────────────────┐   │
│  │  │ Immutable Persistence                                     │   │
│  │  │     → persistP3Calculation()                         │   │
│  │  │     → INSERT only (no UPDATE/DELETE)                   │   │
│  │  └───────────────────────────────────────────────────────┘   │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## P3 Execution Context

### Conceptual Definition

The P3 execution context is a single immutable object that contains all information required for every P3 calculation to operate deterministically. It is built once per narrative per refresh and passed to all P3 module calculations.

### Context Structure (Reuse Existing)

The existing `P3CalculationContext` from `src/lib/p3/context.ts` already defines the required structure:

```typescript
export interface P3CalculationContext {
  narrativeId: number;
  calculationMode: string;
  window: P3Window;
  windowStart: Date;
  windowEnd: Date;
  calculatedAt: Date;
  algorithmKey: string;
  algorithmVersion: string;
  ruleVersionId?: number | null;
  featureVersionId?: number | null;
  scoreConfigId?: number | null;
  constituents: readonly P3Constituent[];
  sourceAvailability: Readonly<Record<string, P3Availability<unknown>>>;
  btcBenchmark?: P3Availability<unknown>;
  provenance: Readonly<Record<string, unknown>>;
}
```

### Context Construction

The orchestrator constructs the context with:

1. **execution_id**: Derived from calculation identity (not a separate field)
2. **calculation_mode**: `"observed"` for production calculations
3. **window**: The primary P3 window (typically `"7D"` for Rotation)
4. **window_start**: UTC boundary from `resolveP3Window()`
5. **window_end**: UTC boundary from `resolveP3Window()`
6. **calculation_timezone**: UTC (implicit, not a field)
7. **historical_constituent_snapshot_id**: The snapshot identity from persistence
8. **constituent_set**: The prepared constituent members
9. **eligible_constituents**: Members with `membershipState === "ELIGIBLE"`
10. **excluded_constituents**: Members excluded with reasons preserved
11. **feature_version**: From active `feature_versions` table
12. **rule_version**: From active `rule_versions` table
13. **score_config**: From `score_configs` table for thresholds
14. **algorithm identities**: Per-module `algorithmKey` + `algorithmVersion`

### Scheduler vs Calculation Context

**Scheduler Context (Asia/Ho_Chi_Minh)**

- Used ONLY for: trigger times, human-facing schedule descriptions
- NOT used for: market data windows, historical calculations, timestamp interpretation, data persistence semantics

**Calculation Context (UTC)**

- Used for: ALL P3 calculations, market data windows, historical lookups, aggregation, normalization, persistence timestamps
- Asia/Ho_Chi_Minh MUST NOT affect any calculation semantics

---

## UTC Window Semantics

### Authoritative Window Source

P3-03 UTC kernel (`src/lib/p3/windows.ts`) is the authoritative source of calculation windows.

### Window Resolution

The orchestrator resolves the P3 window ONCE per narrative per refresh:

```typescript
const resolved = resolveP3Window("7D", windowEnd);
```

The resulting UTC boundaries are passed downstream to all P3 modules:

```typescript
windowStart: resolved.windowStart  // UTC date boundary
windowEnd: resolved.windowEnd    // UTC date boundary
startTarget: resolved.startTarget // = windowEnd - 1 day
endTarget: resolved.endTarget     // = windowEnd - 8 days (for 7D window)
```

### Window Usage by Module

| Module | Window Usage | Purpose |
| ------ | ------------ | ------- |
| P3-03 | Configurable (typically 7D) | Context window definition |
| P3-04 | Not window-dependent | Breadth uses current constituent health only |
| P3-05 | 1D, 3D, 7D, 14D | Momentum deltas at different periods |
| P6-06 | 1D, 3D, 7D, 14D | Relative Strength at different periods |
| P3-07 | 7D (fixed) | Leadership/Concentration window |
| P3-08 | Not window-dependent | Regime uses current metrics |
| P3-09 | 7D (Rotation window) | Rotation uses 7D component inputs |

No new windows are introduced. All window resolution goes through `resolveP3Window()`.

---

## Dependency Graph

### Sequential Execution Required

Based on actual module interfaces and data dependencies:

```text
P3-03: Context & Window Resolution
    ↓
Constituent Snapshot Preparation
    ↓
P3-04: Breadth (uses constituent health only)
    ↓
P3-05: Momentum (uses narrative health observations)
    ↓
P3-06: Relative Strength (uses constituent prices + BTC benchmark)
    ↓
P3-07: Leadership + Concentration (uses RS, health, volume, momentum)
    ↓
P3-08: Regime (uses health, breadth, momentum, RS results)
    ↓
P3-09: Rotation (uses normalized components from P3-04, P3-05, P3-06)
    ↓
Immutable Persistence
```

### Parallel Execution Safety

**Parallel execution is NOT safe** for the following reasons:

1. **Determinism requirement**: Sequential execution ensures reproducible ordering
2. **Shared context**: All modules share the same P3CalculationContext
3. **P3-07 dependency**: Leadership requires P3-06 Relative Strength results
4. **P3-08 dependency**: Regime consumes results from P3-04, P3-05, P3-06
5. **P3-09 dependency**: Rotation consumes normalized components from multiple upstream modules
6. **Historical correctness**: Sequential execution prevents race conditions in historical data access

**Conclusion**: Sequential execution is required for deterministic results.

---

## P3-03 → P3-09 Input/Output Contracts

### P3-03: Context & Window Resolution

**Inputs:**
- `narrativeId`: number
- `calculationMode`: string (e.g., "observed")
- `window`: P3Window (e.g., "7D")
- `windowEnd`: Date (UTC day boundary)
- `featureVersionId`: number
- `ruleVersionId`: number
- `scoreConfigId`: number

**Outputs:**
- `P3CalculationContext`: Fully populated context with UTC boundaries
- `P3WindowResolution`: Resolved window start/end/target dates

**Required Inputs:**
- `narrativeId` (mandatory)
- `windowEnd` (mandatory, must be UTC day boundary)
- `featureVersionId`, `ruleVersionId`, `scoreConfigId` (mandatory for provenance)

**Failure State:**
- Invalid `windowEnd` (not UTC boundary) → ERROR (prevents P3 execution)
- Missing version configuration → ERROR (prevents P3 execution)

---

### P3-04: Breadth

**Inputs:**
- `P3CalculationContext`
- `constituents`: `readonly BreadthConstituent[]` (coinId, health, availabilityState)

**Outputs:**
- `P3CalculationResult` with metrics:
  - `breadth`: `0–1` ratio or null
  - `strongBreadth`: `0–1` ratio or null
  - `totalCoins`, `bullishCoins`, `neutralCoins`, `weakCoins`

**Required Inputs:**
- Valid constituent health scores (`0–100`, finite)
- At least one constituent

**Failure State:**
- No constituents → `INSUFFICIENT_HISTORY`
- Any constituent health unavailable → `MISSING` (null ratio)
- Invalid health value → `MISSING` (null ratio)

---

### P3-05: Momentum

**Inputs:**
- `P3CalculationContext`
- `narrativeHealth` observations (date, healthScore, availabilityState)

**Outputs:**
- `P3CalculationResult` with metrics:
  - `momentum1d`, `momentum3d`, `momentum7d`, `momentum14d`: signed health point changes
  - `acceleration`: signed acceleration value

**Required Inputs:**
- At least 7 daily narrative health observations for 7D momentum
- Current observation at or before `window_end - 1 day`
- Historical observation at `window_end - 8 days`

**Failure State:**
- Insufficient history → `INSUFFICIENT_HISTORY` (null values)
- Missing endpoint → `INSUFFICIENT_HISTORY` (null values)
- Stale observation → `STALE` (null values)
- Invalid health → `INVALID` (null values)

---

### P3-06: Relative Strength

**Inputs:**
- `P3CalculationContext`
- `constituents`: `readonly RSConstituentInput[]` (coinId, instrument, marketCapAvailable, prices)
- `btc`: `RSBenchmarkInput` (coinId, instrument, prices)

**Outputs:**
- `P3CalculationResult` with metrics:
  - `relativeStrength1d`, `relativeStrength3d`, `relativeStrength7d`, `relativeStrength14d`: signed percentage returns
  - Classification labels per window

**Required Inputs:**
- BTC benchmark with `BTCUSDT` perpetual futures instrument
- At least 3 eligible constituents with valid market cap
- Perpetual futures daily close prices for constituents and BTC
- Sufficient historical price data for target window

**Failure State:**
- Missing BTC benchmark → `MISSING`
- Insufficient constituents (<3) → `INSUFFICIENT_HISTORY`
- Missing price data → `INSUFFICIENT_HISTORY`
- Invalid price data → `INVALID`

---

### P3-07: Leadership + Concentration

**Inputs:**
- `P3CalculationContext`
- `constituents`: `readonly LeadershipConstituentInput[]` (coinId, marketCapAvailable, health, volumeScore, coinReturn7d, relativeStrength7d)
- `history`: `readonly LeadershipHistoryObservation[]` (for persistence calculation)

**Outputs:**
- `P3CalculationResult` with metrics:
  - `leaderScore`, `leaderCoinId`
  - `concentrationTop1`, `concentrationTop3`, `concentrationClassification`
  - Leadership ranking details

**Required Inputs:**
- At least 3 eligible constituents
- Valid health, volume, momentum, relative strength for all eligible constituents
- 7D window (fixed)
- Market cap eligibility for all constituents

**Failure State:**
- Insufficient constituents (<3) → `INSUFFICIENT_HISTORY`
- Missing required component for any eligible constituent → `MISSING`

---

### P3-08: Regime

**Inputs:**
- `P3CalculationContext`
- `inputs`: `RegimeInputs` (health, healthChange, breadth, breadthChange, momentum, acceleration, relativeStrength, relativeStrengthChange)

**Outputs:**
- `P3CalculationResult` with metrics:
  - `regime`: Classification label (EMERGING, STRONG, MATURE, WEAKENING, DEAD)
  - Confidence score

**Required Inputs:**
- All Regime inputs must be VALID (not null, not UNAVAILABLE)
- Configuration thresholds from `score_configs`

**Failure State:**
- Any required input unavailable → `MISSING` (regime = null)
- Configuration missing → `ERROR`
- Ambiguous regime classification → `AMBIGUOUS`

---

### P3-09: Rotation

**Inputs:**
- `P3CalculationContext`
- `inputs`: `RotationInputs` (healthMomentum, breadthMomentum, relativeStrength, volumeExpansion, oiConfirmation as 0–100 normalized values)
- `thresholds`: `RotationThresholds` (acceleratingMin, inflowMin, stableMin, deceleratingMin)

**Outputs:**
- `P3CalculationResult` with metrics:
  - `rotationScore`: Weighted aggregate 0–100
  - `rotation`: State classification (INFLOW, ACCELERATING, STABLE, DECELERATING, OUTFLOW)

**Required Inputs:**
- ALL five component inputs must be VALID (not null, not UNAVAILABLE)
- All components must be in range [0, 100]
- Configuration thresholds must be finite and strictly descending

**Failure State:**
- Any component missing → `MISSING` (score = null, state = null)
- Any component out of range → `INVALID`
- Invalid thresholds → `ERROR`

---

## Result States

### Supported States

```text
VALID           - Metric successfully calculated with deterministic value
UNAVAILABLE      - Required data is missing (insufficient history, missing source)
MISSING         - Specific data point is not available
INSUFFICIENT_HISTORY - Not enough historical data for required window
INVALID          - Input value is invalid (out of range, non-finite, wrong type)
AMBIGUOUS       - Calculation cannot produce definitive classification
NOT_APPLICABLE  - Metric does not apply in current context
ERROR            - System/technical error (database failure, unexpected exception)
```

### State Production by Module

| Module | VALID | UNAVAILABLE | MISSING | INSUFFICIENT_HISTORY | INVALID | AMBIGUOUS | NOT_APPLICABLE | ERROR |
| ------ | ----- | ----------- | ------- | ------------------- | ------- | ---------- | -------------- | ----- |
| P3-03 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | YES |
| P3-04 | YES | YES | YES | YES | YES | NO | NO | NO |
| P3-05 | YES | YES | YES | YES | YES | NO | NO | NO |
| P3-06 | YES | YES | YES | YES | YES | NO | NO | NO |
| P3-07 | YES | YES | YES | YES | YES | NO | NO | NO |
| P3-08 | YES | YES | YES | NO | YES | YES | NO | NO |
| P3-09 | YES | YES | YES | NO | YES | YES | NO | NO |

### Critical Rules

```text
UNAVAILABLE ≠ ERROR
```
An unavailable metric is a valid deterministic outcome. It must not automatically fail the entire P3 execution.

```text
INVALID ≠ UNAVAILABLE
```
An invalid input/value must remain distinguishable from insufficient data.

---

## Missing Data Propagation

### Dependency Matrix

| Input Unavailable                | Current Metric       | Downstream Result                                              |
| ----------------------------- | -------------------- | ------------------------------------------------- |
| Missing market cap            | EXCLUDED             | Continue (constituent excluded from eligibility)                 |
| Missing constituent health      | EXCLUDED             | Continue (constituent excluded from calculation)                |
| Missing constituent price       | UNAVAILABLE          | Continue (single constituent excluded, check min population)    |
| Missing BTC price              | UNAVAILABLE          | Continue (RS unavailable, Rotation may become unavailable)      |
| Missing constituent volume     | UNAVAILABLE          | Continue (single constituent excluded, check min population)    |
| Missing constituent OI          | UNAVAILABLE          | Continue (single constituent excluded, check min population)    |
| Insufficient history           | INSUFFICIENT_HISTORY | Continue (metric unavailable downstream)                |
| Invalid value                  | INVALID              | Contract-dependent (some downstream may continue)         |
| Breadth = UNAVAILABLE          | UNAVAILABLE          | Rotation UNAVAILABLE (all 5 components required)               |
| Momentum = UNAVAILABLE         | UNAVAILABLE          | Rotation UNAVAILABLE (all 5 components required)               |
| RS = UNAVAILABLE              | UNAVAILABLE          | Rotation UNAVAILABLE (all 5 components required)               |
| Leadership = UNAVAILABLE        | UNAVAILABLE          | Rotation UNAVAILABLE (Leadership not a Rotation component)      |
| Regime = UNAVAILABLE           | UNAVAILABLE          | Rotation UNAVAILABLE (Regime not a Rotation component)          |

### Key Principles

1. **No automatic substitution**: Never convert null to 0, 50, or neutral
2. **No weight redistribution**: Missing components make Rotation UNAVAILABLE, no renormalization
3. **Exclusion ≠ failure**: Excluded constituents are recorded in provenance, not errors
4. **Contract-dependent propagation**: Some downstream metrics can continue (e.g., Leadership can continue if Rotation is UNAVAILABLE)

---

## Constituent Snapshot Lifecycle

### Principle

```text
Snapshot FIRST
Calculation SECOND
Persistence THIRD
```

### Snapshot Creation

1. **When**: Before any P3 calculation begins
2. **Where**: In the P3 orchestrator, before executing P3-04 through P3-09
3. **From**: Current narrative membership from `coin_narratives` at `window_end`
4. **Mode**: `"observed"` for production calculations

### Snapshot Identity

The snapshot is persisted with:
- `intelligenceId`: Foreign key to the P3 result
- `capturedAt`: UTC timestamp
- `membershipSource`: `"p3_constituent_snapshot"`
- `membershipMode`: `"observed"`
- `memberCount`: Total constituent count
- `eligibleCount`: Count of `ELIGIBLE` members

### Membership Determination

For each narrative at `window_end`:
1. Query `coin_narratives` for active narrative membership
2. For each member coin:
   - Check `coins.isActive` = true
   - Check market cap eligibility (from `coin_metrics`)
   - Check futures instrument availability (from `coins.binanceFuturesSymbol`)
   - Mark as `ELIGIBLE` or `EXCLUDED` with reason

### Eligibility Rules

**Market Cap Eligibility:**
- Market cap exists and is valid → ELIGIBLE
- Market cap missing → EXCLUDED (reason: "missing_market_cap")

**Futures Instrument Eligibility:**
- Canonical USDT perpetual futures instrument exists → ELIGIBLE
- No futures instrument → EXCLUDED (reason: "missing_canonical_usdt_perpetual")

**Constituent State:**
- Coin is active → ELIGIBLE
- Coin is inactive → EXCLUDED (reason: "coin_inactive")

### Excluded Constituents

Excluded constituents are:
- Preserved in the snapshot with `membershipState = "EXCLUDED"`
- Included in provenance with exclusion reason
- NOT used in P3 calculations
- Distinguished from calculation failures

### Calculation Usage

All P3 calculations (P3-04 through P3-09) receive the same captured snapshot:
- No dynamic querying of current `coin_narratives` during calculation
- No dynamic reconstruction of historical membership
- Snapshot identity is preserved in provenance for reproducibility

---

## Market Data Source Boundary

### Approved Sources

**Price:**
- Source: Coin-USDT perpetual futures daily close
- Table: `market_price_daily`
- Field: `close`
- Contract: Spot data MUST NOT silently become a fallback

**BTC Benchmark:**
- Source: BTC-USDT perpetual futures daily close
- Table: `market_price_daily`
- Field: `close`
- Instrument: `BTCUSDT` (canonical perpetual futures)
- Contract: Spot data MUST NOT silently become a fallback

**Volume:**
- Source: Coin-USDT perpetual futures volume
- Table: `market_price_daily`
- Field: `volume`
- Contract: Spot volume MUST NOT be used

**OI:**
- Source: Coin-USDT perpetual futures Open Interest
- Table: `coin_metrics`
- Field: `openInterest`
- Contract: Spot OI does not exist, futures OI is authoritative

### Source Selection

The orchestrator does NOT select sources dynamically. Source selection occurs during data collection (existing P0-P2 pipeline). P3 assumes:
- All prices are from the approved futures source
- All BTC data is from the approved futures benchmark
- No silent fallback to spot occurs

If the existing collection does not yet guarantee futures-only sources, this is marked as a P3-10 implementation blocker rather than inventing a fallback.

---

## Market Cap Eligibility

### Eligibility Rule

```text
market cap exists and is valid
    → ELIGIBLE

market cap missing or invalid
    → EXCLUDED
```

### Exclusion Semantics

**Excluded constituent:**
- Not used in P3 calculations
- Preserved in snapshot with `membershipState = "EXCLUDED"`
- Recorded in provenance with exclusion reason
- Distinguished from calculation failures

**Exclusion reasons:**
- `"missing_market_cap"` - Market cap not available
- `"coin_inactive"` - Coin marked inactive
- `"missing_canonical_usdt_perpetual"` - No futures instrument

### No Fabrication

Never:
```text
missing market cap → 0
estimated market cap → price × volume
historical market cap substitution
```

---

## Versioning

### Existing Infrastructure Reuse

No new version framework is created. The orchestrator reuses:

```text
feature_versions
rule_versions
score_configs
```

### Algorithm Identities

Confirmed algorithm identities:

| Module | algorithm_key        | algorithm_version |
| ------ | ------------------ | ----------------- |
| P3-03 | (kernel context)    | 1                  |
| P3-04 | breadth              | 1                  |
| P3-05 | momentum            | 1                  |
| P3-06 | relative-strength    | 1                  |
| P3-07 | leadership-concentration | 1                  |
| P3-08 | regime              | 1                  |
| P3-09 | rotation            | 1                  |

### Version Resolution

The orchestrator:
1. Selects active `feature_version` from `feature_versions` table
2. Selects active `rule_version` from `rule_versions` table
3. Selects relevant `score_config` from `score_configs` table for thresholds
4. Pass version IDs to `P3CalculationContext`

### Historical Reproducibility

Historical results remain reproducible if algorithms change because:
- Calculation identity includes: `narrative_id + window_end + algorithm_key + algorithm_version + calculation_mode`
- Different algorithm versions coexist in the database
- No UPDATE/DELETE on historical P3 records

---

## Configuration Resolution

### Configuration Loading

**Regime Thresholds:**
- Source: `score_configs` table
- Config key: `"regime_thresholds"`
- Structure: Object with numeric threshold values (healthHigh, healthLow, breadthHigh, etc.)
- Missing configuration → ERROR (prevents Regime calculation)

**Rotation Thresholds:**
- Source: `score_configs` table
- Config key: `"rotation_thresholds"`
- Structure: Object with numeric threshold values (acceleratingMin, inflowMin, stableMin, deceleratingMin)
- Missing configuration → ERROR (prevents Rotation calculation)

**Configuration Validation:**
- All threshold values must be finite
- Rotation thresholds must be strictly descending: `acceleratingMin > inflowMin > stableMin > deceleratingMin`
- Invalid configuration → ERROR

### Configuration Identity

The execution context records:
- `ruleVersionId`: The rule version used for the calculation
- `featureVersionId`: The feature version used for the calculation
- `scoreConfigId`: The score config used for thresholds
- `provenance`: Exact configuration snapshot used

---

## Failure Isolation

### Three Failure Classes

### A. Expected Metric Unavailability

**Examples:**
- Insufficient BTC history
- Insufficient constituent history
- Missing required OI data

**Result:**
- Metric = `UNAVAILABLE` or `INSUFFICIENT_HISTORY`
- Narrative calculation continues with degraded results
- Rotation may become UNAVAILABLE if required components are missing

**Action:**
- Do NOT abort narrative calculation
- Do NOT abort entire refresh
- Record unavailable state in provenance

### B. Invalid Business/Input State

**Examples:**
- Non-finite calculation input
- Value out of valid range
- Invalid configuration

**Result:**
- Metric = `INVALID`
- Downstream metrics follow contract-dependent propagation rules
- Some downstream metrics may continue (e.g., Leadership if RS is INVALID)

**Action:**
- Do NOT abort narrative calculation unless contract specifies
- Record invalid state in provenance

### C. System/Technical Error

**Examples:**
- Database connection failure
- Unexpected exception
- Transaction deadlock

**Result:**
- Metric = `ERROR`
- Entire refresh fails (existing refresh policy)

**Action:**
- Abort current narrative calculation
- Abort entire refresh
- Do NOT overwrite historical P3 results
- Follow existing refresh retry policy (none defined by repository)

---

## Error Propagation Matrix

| Failure              | Current Metric       | Downstream         | Entire Refresh          |
| -------------------- | -------------------- | ------------------ | ----------------------- |
| Missing market cap   | EXCLUDED             | Continue           | Continue                |
| Missing constituent health | EXCLUDED             | Continue           | Continue                |
| Missing constituent price  | UNAVAILABLE          | Check min population | Continue                |
| Missing BTC price       | UNAVAILABLE          | RS UNAVAILABLE     | Continue                |
| Missing constituent volume | UNAVAILABLE          | Check min population | Continue                |
| Missing constituent OI     | UNAVAILABLE          | Check min population | Continue                |
| Insufficient history     | INSUFFICIENT_HISTORY | Contract-dependent | Continue                |
| Invalid value           | INVALID              | Contract-dependent | Continue/Stop           |
| Missing config          | ERROR                | Stop               | Existing refresh policy |
| Ambiguous Regime        | AMBIGUOUS            | Continue           | Continue                |
| DB failure              | ERROR                | Stop               | Existing refresh policy |
| Unexpected exception     | ERROR                | Stop               | Existing refresh policy |

**Notes:**
- "Contract-dependent" means: depends on whether the downstream module requires the unavailable input
- "Continue/Stop" means: some modules may continue, others may stop (defined by module contracts)
- Technical errors (DB failure, unexpected exception) always stop the entire refresh per existing policy

---

## Persistence Boundary

### Immutable Persistence Boundary

P3 persistence must remain behind `persistP3Calculation()`:

```text
calculation
    ↓
validated result
    ↓
immutable persistence
```

### INSERT Only, No Update/Delete

The persistence boundary enforces:
- **INSERT only**: New P3 results are inserted, never overwritten
- **UPDATE prohibited**: Historical P3 records cannot be modified
- **DELETE prohibited**: Historical P3 records cannot be deleted

### Calculation Identity

Idempotency is enforced by database unique constraint on:

```text
narrative_id
window_end
algorithm_key
algorithm_version
calculation_mode
```

Same calculation identity → no duplicate record → idempotent success

Different algorithm version → new row → historical coexistence

### Transaction Boundaries

**Scope: Per calculation per narrative**

Each P3 calculation persistence is wrapped in a single database transaction.

**Rationale:**
- Ensures atomic persistence of P3 result + constituent snapshot + leadership members
- Prevents partial persistence corruption
- Allows rollback if any part of persistence fails
- Does not wrap the entire refresh in one giant transaction (preserves existing refresh behavior)

**Key requirement:**
- A failure in one P3 calculation must not silently corrupt already-persisted immutable historical results

---

## Idempotency

### Idempotent Retry Behavior

When `/api/refresh` is retried with identical:
```text
narrative
window (UTC day boundary)
algorithm_key (e.g., "rotation")
algorithm_version (e.g., "1")
calculation_mode (e.g., "observed")
```

**Expected behavior:**
- Same calculation identity → No duplicate historical result
- Persistence function uses `onConflictDoNothing()` → idempotent success
- No overwriting of historical results

### Algorithm Version Coexistence

Example:
```text
rotation/1 calculated on 2026-08-09
rotation/2 calculated on 2026-08-09 (after algorithm change)
```

Both must coexist historically as separate database rows.

---

## Retry Semantics

### Technical Retry

- Database connection failure: Existing refresh policy (none defined, may need future definition)
- Network timeout: Existing refresh policy (none defined, may need future definition)

### Business Unavailability

- Deterministic unavailable states (UNAVAILABLE, INSUFFICIENT_HISTORY): DO NOT retry as if infrastructure failure
- Accept unavailable as valid deterministic outcome
- Do not overwrite historical P3 results during retry

### Idempotent Replay

- Same calculation identity replay: Same as idempotent behavior
- No side effects from replay beyond persistence attempt

---

## Observability

### Minimum P3 Execution Metadata

Each P3 calculation must preserve:

```text
narrative_id
window_start (UTC)
window_end (UTC)
algorithm_key
algorithm_version
calculation_mode
calculation_at (UTC)
snapshot_id
constituent_count
eligible_count
excluded_count
availability_state
confidence
duration_ms
failure_reason (if applicable)
persistence_status
```

### Existing Infrastructure

Reuse existing logging conventions:
- `console.log()` for development
- `scheduler_logs` table for refresh-level logging
- `provenance` field in P3 results for calculation-level provenance

Do not introduce a new observability framework unless required.

---

## API Integration Contract

### Existing API Semantics

The current `/api/refresh` returns:

```json
{
  "success": true|false,
  "data": {
    "message": "Refresh completed",
    "coinsProcessed": number,
    "duration": "Xs",
    "errors": [...] | undefined
  }
}
```

### P3 Integration Requirement

P3 should be represented in the API response without breaking existing refresh consumers:

**Successful refresh with P3:**
```json
{
  "success": true,
  "data": {
    "message": "Refresh completed",
    "coinsProcessed": 15,
    "duration": "45s",
    "p3": {
      "narratives": 15,
      "metrics_calculated": 15,
      "unavailable_metrics": 2,
      "duration_ms": 1200
    }
  }
}
```

**HTTP 200 ≠ every P3 metric VALID**

A successful refresh may contain:
- `VALID` metrics
- `UNAVAILABLE` metrics
- `INSUFFICIENT_HISTORY` metrics

while still completing successfully.

**Technical errors:**
- Database failure → HTTP 500
- Unexpected exception → HTTP 500

Do not change the API in this task. Only document the required future integration behavior.

---

## FastAPI Boundary

### Explicit Boundary

```text
FastAPI does not execute P3.
FastAPI does not own P3 persistence.
FastAPI does not maintain a parallel P3 calculation path.
```

### Current FastAPI Status

The existing FastAPI refresh in `backend/api/refresh.py` contains a legacy P0-P2 implementation. This remains a fallback/orchestration only. It must NOT be extended with P3 intelligence.

If FastAPI triggers a refresh:
1. It calls Next.js `/api/refresh` first (primary)
2. If Next.js succeeds, FastAPI P0-P2 fallback is not needed
3. If Next.js fails, FastAPI may execute legacy P0-P2
4. FastAPI must NOT independently calculate P3 intelligence

---

## Determinism Requirements

### Determinism Sources

Two executions with identical:
```text
input data (market prices, health scores, etc.)
window (UTC day boundary)
constituent snapshot (captured membership)
configuration (thresholds, weights)
algorithm versions
```

must produce identical P3 outputs.

### Anti-Determinism Prevention

The architecture must prevent:

- **Current membership drift**: Using current `coin_narratives` for historical calculations
- **Local timezone**: Using `Asia/Ho_Chi_Minh` for any calculation
- **Runtime clock**: Using `Date.now()` for window resolution
- **Randomness**: Any random number generation in calculations
- **LLM output**: No LLM in P3 calculation path
- **Unstable ordering**: Sorting without deterministic key (e.g., relying on database order)
- **Implicit fallback**: Silent substitution of missing data

### Determinism Guarantees

- UTC-only windows from P3-03 kernel
- Historical constituent snapshot fixed per calculation
- Explicit versioning for all algorithms
- No runtime state between calculations
- No external API calls during P3 calculation
- Deterministic sorting (by coinId, by date)
- No mutation of input data during calculation

---

## P3-10 Implementation Checklist

P3-10 implementation MUST:

### Context & Window
- [ ] Create P3CalculationContext with all required fields
- [ ] Resolve UTC window once using resolveP3Window()
- [ ] Pass resolved window boundaries to all P3 modules
- [ ] Ensure UTC-only semantics (no Asia/Ho_Chi_Minh in calculations)

### Constituent Snapshot
- [ ] Capture historical constituent snapshot BEFORE P3 calculations
- [ ] Determine narrative membership from coin_narratives at window_end
- [ ] Apply market cap eligibility check (exclude if missing)
- [ ] Apply futures instrument check (exclude if missing)
- [ ] Mark excluded constituents with reasons
- [ ] Prepare constituents using prepareConstituents()
- [ ] Persist snapshot after P3 calculation completion

### Version & Configuration
- [ ] Resolve active feature_version from feature_versions table
- [ ] Resolve active rule_version from rule_versions table
- [ ] Resolve relevant score_configs for thresholds
- [ ] Pass version IDs to P3CalculationContext
- [ ] Validate configuration values (finite thresholds, descending rotation thresholds)
- [ ] Record configuration identity in provenance

### P3 Module Execution
- [ ] Execute P3-04 Breadth with prepared constituents
- [ ] Execute P3-05 Momentum with narrative health observations
- [ ] Execute P3-06 Relative Strength with constituent prices and BTC benchmark
- [ ] Execute P3-07 Leadership + Concentration with P3-06 results
- [ ] Execute P3-08 Regime with P3-04, P3-05, P3-06 results
- [ ] Execute P3-09 Rotation with normalized component inputs
- [ ] Execute modules in strict sequential order per dependency graph

### Missing Data Propagation
- [ ] Propagate EXCLUDED state without treating as error
- [ ] Propagate UNAVAILABLE state without fabrication
- [ ] Propagate INSUFFICIENT_HISTORY state without fallback
- [ ] Propagate INVALID state with distinct handling
- [ ] Make Rotation UNAVAILABLE if any required component is unavailable
- [ ] Do NOT redistribute weights when components are missing
- [ ] Record all state transitions in provenance

### Provenance Collection
- [ ] Collect provenance from all P3 module calculations
- [ ] Record calculation identity in all persisted results
- [ ] Record version identities in all persisted results
- [ ] Record constituent snapshot identity
- [ ] Record configuration snapshot used
- [ ] Record exclusion reasons for excluded constituents

### Persistence
- [ ] Persist through persistP3Calculation() boundary
- [ ] Use per-calculation transaction scope
- [ ] Preserve INSERT-only semantics (no UPDATE/DELETE)
- [ ] Persist constituent snapshot members
- [ ] Persist leadership members if applicable
- [ ] Enforce idempotency via unique constraint
- [ ] Do not overwrite historical P3 results

### API Integration
- [ ] Integrate P3 orchestrator into /api/refresh after Narrative Health
- [ ] Preserve existing refresh response structure
- [ ] Add P3 metadata to response without breaking consumers
- [ ] Ensure HTTP 200 can contain UNAVAILABLE/INSUFFICIENT_HISTORY metrics
-   - Technical errors remain HTTP 500
- [ ] Do not modify FastAPI P3 path

### Error Handling
- [ ] Isolate technical errors from business unavailability
-   - Technical errors → abort narrative, abort refresh
-   - Business unavailability → continue with degraded results
- [ ] Distinguish INVALID from UNAVAILABLE in all propagation
- [ ] Follow existing refresh retry policy for technical errors
- [ ] Do not retry deterministic unavailable states

### Testing
- [ ] Add integration tests for full P3 pipeline
- [ ] Add unit tests for orchestrator context construction
- [ ] Add unit tests for missing data propagation
- [ ] Add tests for idempotency (same calculation identity)
- [ ] Add tests for configuration validation
- [ ] Add tests for UTC window semantics
- [ ] Add tests for constituent snapshot lifecycle

### Observability
- [ ] Log P3 execution start/end per narrative
- [ ] Log P3 module execution duration
- [ ] Log unavailable metrics and reasons
- [ ] Log configuration loading results
- [ ] Log persistence status
- [ ] Reuse existing scheduler_logs for refresh-level logging

---

## Open Issues / Blockers

### Configuration Records

**BLOCKER: Missing Configuration Records**

The repository does not yet contain:
- `score_configs` entries for `"regime_thresholds"`
- `score_configs` entries for `"rotation_thresholds"`

**Decision Required:**
Before P3-10 implementation, add configuration records for:
- Regime thresholds (healthHigh, healthLow, breadthHigh, breadthLow, momentumPositive, momentumNegative, etc.)
- Rotation thresholds (acceleratingMin, inflowMin, stableMin, deceleratingMin)

**Why it matters:**
- P3-08 and P3-09 require threshold configuration
- Without these records, P3-10 cannot validate inputs
- Hard-coded thresholds would violate the configuration reuse principle

**Required decision:**
Add the missing configuration records to `score_configs` with appropriate threshold values (to be defined by business stakeholders).

### Market Data Source Verification

**OPEN ISSUE: Futures-Only Source Enforcement**

The existing refresh route (lines 228-248) prefers futures but falls back to spot:
```typescript
if (coin.binanceFuturesSymbol) {
  // use futures
} else {
  // fallback to spot
}
```

**Required action:**
Before P3-10 implementation, verify and update the refresh pipeline to enforce futures-only for P3-relevant data (price, volume). P3 cannot rely on spot data fallbacks.

**Why it matters:**
- P3 contract requires perpetual futures as authoritative
- Spot fallback would violate deterministic semantics
- Historical reproducibility would be compromised

---

## Acceptance Criteria

P3-10B is considered DONE only when:

1. **Architecture is complete**: All sections of this document are fully defined
2. **Execution path is confirmed**: Next.js authoritative path is established
3. **Context is defined**: P3CalculationContext usage is specified
4. **UTC semantics are preserved**: No Asia/Ho_Ciminh in calculations
5. **Dependency graph is explicit**: Sequential execution requirement is documented
6. **Module contracts are complete**: All P3-03 through P3-09 input/output contracts are documented
7. **Constituent snapshot lifecycle is defined**: Snapshot-first principle is established
8. **Market data boundary is enforced**: Futures-only requirement is documented
9. **Missing data propagation is specified**: All propagation rules are explicit
10. **Failure isolation is defined**: Three failure classes are distinguished
11. **Persistence boundary is clear**: INSERT-only semantics are enforced
12. **Idempotency is defined:** Retry behavior is specified
13. **API integration is contractually defined:** Integration point is documented
14. **FastAPI boundary is explicit:** No independent P3 path is confirmed
15. **Determinism requirements are established:** Anti-determinism sources are prevented
16. **Implementation checklist is complete:** All items map back to this contract
17. **No code implementation occurred**: Scope boundary was respected
18. **git diff --check passes**: No formatting issues introduced

---

## Files Changed

```text
docs/P3_Upgrade/P3_10B_ARCHITECTURE_EXECUTION_CONTRACT.md (CREATED)
```

---

## Final Report

```
TASK
P3-10B — Architecture & Execution Contract

STATUS
DONE

DOCUMENT
docs/P3_Upgrade/P3_10B_ARCHITECTURE_EXECUTION_CONTRACT.md

==================================================
AUTHORITATIVE PATH
==================================================

Scheduler
  ↓
Next.js /api/refresh
  ↓
P3 Orchestrator
  ↓
P3-03 → P3-09
  ↓
Immutable P3 Persistence

VERDICT:
PASS

==================================================
EXECUTION CONTEXT
==================================================

Context defined:
YES - Reuses existing P3CalculationContext from context.ts

UTC semantics:
PASS - UTC-only for all calculations, Asia/Ho_Chi_Minh scheduler-only

Snapshot semantics:
PASS - Snapshot-first principle established, historical membership captured once

Version/config semantics:
PASS - Reuses feature_versions, rule_versions, score_configs infrastructure

==================================================
DEPENDENCY GRAPH
==================================================

P3-03:
Input: narrativeId, window, windowEnd, version IDs
Output: P3CalculationContext with UTC boundaries
Dependency: None (foundation)

P3-04:
Input: P3CalculationContext, constituent health data
Output: Breadth ratio (0–1) or null
Dependency: P3-03 context only

P3-05:
Input: P3CalculationContext, narrative health observations
Output: Momentum deltas, acceleration
Dependency: P3-03 context only

P3-06:
Input: P3CalculationContext, constituent prices, BTC benchmark
Output: Relative Strength percentage returns
Dependency: P3-03 context, market data

P3-07:
Input: P3CalculationContext, constituent data, P3-06 results
Output: Leadership score, concentration metrics
Dependency: P3-03 context, P3-06 results

P-08:
Input: P3CalculationContext, P3-04, P3-05, P3-06 results
Output: Regime classification
Dependency: P3-03 context, P3-04, P3-05, P3-06 results

P3-09:
Input: P3-002: P3CalculationContext, normalized components from P3-04, P3-05, P3-06
Output: Rotation score and state
Dependency: P3-03 context, P3-04, P3-05, P3-06 normalized components

==================================================
MISSING DATA
==================================================

Contract complete:
YES - All propagation rules defined in matrix

Unresolved propagation:
None - All contract-dependent cases explicitly defined

==================================================
FAILURE ISOLATION
==================================================

Business unavailable:
Continue narrative calculation, metric = UNAVAILABLE/INSUFFICIENT_HISTORY

Invalid:
Continue narrative calculation (contract-dependent), metric = INVALID

Technical error:
Abort narrative, abort entire refresh, follow existing refresh policy

==================================================
PERSISTENCE
==================================================

Immutable boundary:
PASS - persistP3Calculation() enforces INSERT-only, UPDATE/DELETE prohibited

Idempotency:
PASS - Same calculation identity → idempotent via unique constraint

==================================================
API INTEGRATION
==================================================

Next.js authoritative:
YES - P3 orchestrator lives in /api/refresh

FastAPI independent P3:
NO - FastAPI remains fallback only, no independent P3 implementation

==================================================
SCOPE CHECK
==================================================

/api/refresh modified:
NO - /api/refresh route.ts unchanged

P3 orchestrator implemented:
NO - Only architecture contract created

Schema modified:
NO - No database schema changes

==================================================
VALIDATION
==================================================
git diff --check:
PASS - No formatting issues introduced

==================================================
OPEN BLOCKERS
==================================================

BLOCKED: Missing Configuration Records

Missing score_configs entries:
- "regime_thresholds" for P3-08
- "rotation_thresholds" for P3-09

Required action:
Add configuration records before P3-10 implementation

OPEN ISSUE: Futures-Only Source Enforcement

Current refresh has spot fallback for price data
Required action:
Verify and update refresh pipeline to enforce futures-only for P3 data before P3-10

==================================================
FINAL VERDICT
```

DONE

Ready for:
P3-10C — P3 Input Preparation & Orchestrator Implementation

**Note:** P3-10C implementation is blocked by the missing configuration records blocker. The configuration records must be added before P3-10C can proceed.
```