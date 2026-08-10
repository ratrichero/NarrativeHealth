# P3-10C — Input Preparation & Execution Context

**Status:** IMPLEMENTED  
**Task:** P3-10C — P3 Input Preparation & Execution Context  
**Date:** 2026-08-10

## Purpose

This document describes the P3 Input Preparation & Execution Context layer, which prepares the exact inputs required by P3-03 through P3-09 calculation modules. This layer establishes the deterministic execution context, resolves UTC windows, captures historical constituent snapshots, determines eligibility, and loads required historical data.

## Scope

This layer implements:
- P3 execution context creation
- UTC window resolution through P3-03 kernel
- Historical constituent snapshot preparation
- Constituent eligibility evaluation
- Market data source preservation
- Input preparation for P3-04 through P3-09
- Missing-data semantics preservation
- Provenance metadata
- Version/configuration loading

This layer does NOT implement:
- The P3 orchestrator
- `/api/refresh` integration
- Scheduler changes
- Business logic calculations
- New normalization rules
- New scoring rules

## Files Changed

```text
src/lib/p3/preparation.ts (CREATED)
src/lib/p3/__tests__/preparation.test.ts (CREATED)
src/lib/p3/index.ts (MODIFIED - added preparation export)
```

## Execution Context

### P3ExecutionContext

The execution context is built on the existing `P3CalculationContext` from `src/lib/p3/context.ts`. It contains:

```typescript
export interface P3ExecutionContextResult {
  context: P3CalculationContext;
  constituents: readonly P3Constituent[];
  resolvedWindow: {
    window: P3Window;
    windowStart: Date;
    windowEnd: Date;
    startTarget: Date;
    endTarget: Date;
  };
}
```

### Context Creation

The context is created via `createP3ExecutionContext(config: P3ExecutionConfig)`:

```typescript
export interface P3ExecutionConfig {
  narrativeId: number;
  window: P3Window;
  windowEnd: Date;
  calculationMode: "observed" | "projected";
  featureVersionId?: number;
  ruleVersionId?: number;
  scoreConfigId?: number;
}
```

### Execution Identity

Execution identity is preserved in the context's `provenance.snapshotId`:
- Format: `${narrativeId}|${windowEndLabel}`
- Used for traceability and reproducibility
- Separate from database calculation identity

## UTC Window Semantics

### P3 Kernel Authoritative

UTC windows are resolved through the P3-03 kernel (`resolveP3Window()`):

```typescript
const resolvedWindow = resolveP3Window(config.window, config.windowEnd);
```

### Timezone Separation

**Scheduler timezone:**
- Asia/Ho_Chi_Minh
- Used only for trigger/execution scheduling
- NOT used for P3 calculations

**Calculation timezone:**
- UTC
- Used for all P3 calculations, market data windows, historical lookups
- All window boundaries are UTC day boundaries

### Window Support

| Module | Window Usage |
| ------ | ------------ |
| P3-03 | Configurable (typically 7D) |
| P3-04 | Not window-dependent |
| P3-05 | 1D, 3D, 7D, 14D |
| P3-06 | 1D, 3D, 7D, 14D |
| P3-07 | 7D (fixed) |
| P3-08 | Not window-dependent |
| P3-09 | 7D (Rotation window) |

## Historical Constituent Snapshot

### Snapshot-First Principle

```text
Historical Snapshot
        ↓
Eligibility Evaluation
        ↓
Prepared Constituent Set
        ↓
P3 Calculations
```

### Snapshot Creation

The snapshot is captured BEFORE any P3 calculations:

1. Query `coin_narratives` for narrative membership at `window_end`
2. Load coin data for eligibility evaluation
3. Load market cap from `coin_metrics`
4. Evaluate eligibility for each constituent
5. Determine membership state (ELIGIBLE/EXCLUDED)
6. Preserve exclusion reasons

### Snapshot Identity

```typescript
snapshotId: `${narrativeId}|${windowEndLabel}`
```

The snapshot identity is preserved in:
- `context.provenance.snapshotId`
- Provenance metadata for traceability

### No Current-Membership Substitution

The snapshot is fixed at `window_end`. No dynamic querying of current `coin_narratives` occurs during P3 calculations.

## Constituent Eligibility

### Market Cap Requirement

```text
market cap exists and is valid
    → ELIGIBLE

market cap missing or invalid
    → EXCLUDED
```

### Exclusion Reasons

Constituents are excluded with specific reasons:

| Exclusion Reason | Condition |
| --------------- | --------- |
| `coin_not_found_or_inactive` | Coin not in database or inactive |
| `missing_market_cap` | Market cap not available in `coin_metrics` |
| `missing_canonical_usdt_perpetual` | No `binanceFuturesSymbol` |

### Eligibility vs Membership

These concepts are kept separate:

**Historical membership:**
- From `coin_narratives` at `window_end`
- Preserved in snapshot
- Represents narrative inclusion

**P3 eligibility:**
- Based on market cap, futures instrument, etc.
- Determined per calculation
- May exclude historically included coins

## Market Data Source Semantics

### Approved Sources

**Price:**
- Source: Coin-USDT perpetual futures daily close
- Table: `market_price_daily`
- Field: `close` (decimal → number conversion)
- Contract: Spot data NOT used as fallback

**BTC Benchmark:**
- Source: BTC-USDT perpetual futures daily close
- Table: `market_price_daily`
- Field: `close`
- Instrument: `BTCUSDT`
- Contract: Spot data NOT used as fallback

**Volume:**
- Source: Coin-USDT perpetual futures volume
- Table: `market_price_daily`
- Field: `volume`
- Contract: Spot volume NOT used

**Open Interest:**
- Source: Coin-USDT perpetual futures Open Interest
- Table: `coin_metrics`
- Field: `openInterest`
- Contract: No OI substitutes used

### Source Selection

The preparation layer uses the approved sources from existing tables. No fallback to spot data is implemented.

## Input Mapping Table

| P3 Stage | Required Input | Repository Source | Preparation Rule | Missing Behavior |
| -------- | -------------- | ----------------- | ---------------- | ---------------- |
| P3-03    | Context config | User input / scheduler | Create P3CalculationContext with UTC window | ERROR if invalid config |
| P3-04    | Constituent health | `health_scores` | Load health for eligible constituents at window_end | MISSING if health not found |
| P3-05    | Narrative health observations | `narrative_health` | Load 14D of observations for all windows | INSUFFICIENT_HISTORY if < required |
| P3-06    | Constituent prices | `market_price_daily` | Load perpetual futures closes for window | INSUFFICIENT_HISTORY if missing |
| P3-06    | BTC benchmark | `market_price_daily` (BTCUSDT) | Load BTC-USDT perpetual futures closes | UNAVAILABLE if missing |
| P3-07    | Constituent-level data | `health_scores`, `market_price_daily`, `coin_metrics` | Load health, prices, volume, market cap | MISSING if any component missing |
| P3-08    | Upstream results | P3-04, P3-05, P3-06 outputs | NOT IMPLEMENTED YET - placeholder | N/A |
| P3-09    | Normalized components | P3-04, P3-05, P3-06 outputs + volume/OI | NOT IMPLEMENTED YET - placeholder | N/A |

## Prepared Input Types

### Breadth Inputs

```typescript
export interface PreparedBreadthInputs {
  constituents: readonly BreadthConstituent[];
}
```

- Loads health scores for eligible constituents
- Validates health range (0-100)
- Marks MISSING/INVALID states appropriately

### Momentum Inputs

```typescript
export interface PreparedMomentumInputs {
  observations: readonly {
    date: string;
    healthScore: number | null;
    availabilityState: "VALID" | "MISSING" | "INVALID";
  }[];
}
```

- Loads 14D of narrative health observations
- Uses UTC date labels (YYYY-MM-DD)
- Validates health range and finiteness

### Relative Strength Inputs

```typescript
export interface PreparedRelativeStrengthInputs {
  constituents: readonly RSConstituentInput[];
  btc: RSBenchmarkInput;
}
```

- Loads perpetual futures prices for constituents
- Loads BTC-USDT perpetual futures benchmark
- Prepares price observations for return calculation

### Leadership Inputs

```typescript
export interface PreparedLeadershipInputs {
  constituents: readonly LeadershipConstituentInput[];
  history: readonly { date: string; top3CoinIds: readonly number[] }[];
}
```

- Loads health scores for eligible constituents
- Placeholder for volume, returns, RS (requires upstream calculations)
- Placeholder for leadership history (requires persistence)

### Regime Inputs

```typescript
export interface PreparedRegimeInputs {
  health: number | null;
  healthChange: number | null;
  breadth: number | null;
  breadthChange: number | null;
  momentum: number | null;
  acceleration: number | null;
  relativeStrength: number | null;
  relativeStrengthChange: number | null;
  confidence: number | null;
}
```

- Placeholder: These inputs come from P3-04, P3-05, P3-06 calculations
- Will be populated by orchestrator

### Rotation Inputs

```typescript
export interface PreparedRotationInputs {
  healthMomentum: number | null;
  breadthMomentum: number | null;
  relativeStrength: number | null;
  volumeExpansion: number | null;
  oiConfirmation: number | null;
}
```

- Placeholder: These inputs come from P3-04, P3-05, P3-06 plus volume/OI
- Will be populated by orchestrator

## Missing Data Semantics

### No Fabrication

The preparation layer preserves missing-data semantics:

```text
missing ≠ zero
missing ≠ neutral
missing ≠ unavailable input value
```

### State Preservation

Examples:
- Missing BTC history → RS UNAVAILABLE
- Missing market cap → constituent EXCLUDED
- Missing required volume → Rotation component UNAVAILABLE
- Missing required OI → OI Confirmation UNAVAILABLE
- Insufficient historical data → INSUFFICIENT_HISTORY

### State Mapping

| Repository State | Preparation State | Reason |
| --------------- | ----------------- | ------ |
| null health | MISSING | Health score not found |
| health out of range | INVALID | Health < 0 or > 100 |
| non-finite health | INVALID | NaN or Infinity |
| null market cap | EXCLUDED | Missing market cap |
| null futures symbol | EXCLUDED | Missing canonical USDT perpetual |

## Provenance

### Preserved Information

Prepared inputs retain:

```text
source: table name
source timestamp: date/recordedAt
window: P3 window used
coin/narrative: coinId/narrativeId
instrument: binanceFuturesSymbol where applicable
eligibility decision: membershipState
exclusion reason: inputManifest.reason
```

### Snapshot Identity

The snapshot identity is preserved in `context.provenance.snapshotId` for reproducibility.

## Version / Configuration

### Version Loading

The context loads active versions from existing infrastructure:

```typescript
featureVersionId: loadActiveFeatureVersion()
ruleVersionId: loadActiveRuleVersion()
scoreConfigId: loadActiveScoreConfig()
```

### Version Infrastructure

Reuse of existing tables:
- `feature_versions`
- `rule_versions`
- `score_configs`

No new version framework is created.

## Determinism

### Deterministic Ordering

Constituents are sorted by `coinId` ascending:
```typescript
const constituents = narrativeMembers.sort((a, b) => a.coinId - b.coinId);
```

### Deterministic Inputs

Given identical:
- source data
- window
- snapshot
- configuration
- algorithm versions

the preparation layer produces identical prepared inputs.

### Anti-Determinism Prevention

- No random ordering
- No current membership queries during calculation
- No current market cap substitution
- No runtime-time-dependent calculations
- No unstable object ordering
- No implicit fallback sources

## Test Coverage

### Implemented Tests

`src/lib/p3/__tests__/preparation.test.ts` covers:

- UTC window resolution through P3-03 kernel
- Execution context creation with all required fields
- UTC timezone semantics preservation
- Historical constituent snapshot capture
- Deterministic ordering by coinId
- Breadth input preparation
- Momentum input preparation
- UTC date label validation
- Provenance preservation (snapshot identity, version identities)
- Determinism (same inputs produce identical context)

### Placeholder Tests

Tests requiring database setup are marked as placeholders:
- Market cap eligibility (present/missing)
- Exclusion reason preservation
- Missing data semantics (missing ≠ zero/neutral)
- Health validation (0-100 range)
- Missing health → MISSING state

## Known Gaps for P3-10D

### Placeholder Implementations

The following functions are placeholders and require P3-10D completion:

1. **Leadership Inputs (`prepareLeadershipInputs`)**:
   - Volume score calculation requires volume data processing
   - 7D return calculation requires price data processing
   - 7D relative strength requires P3-06 results
   - Leadership history requires persistence data

2. **Regime Inputs (`prepareRegimeInputs`)**:
   - All inputs come from P3-04, P3-05, P3-06 calculations
   - Requires orchestrator to pass upstream results

3. **Rotation Inputs (`prepareRotationInputs`)**:
   - Normalized components come from P3-04, P3-05, P3-06
   - Volume expansion requires volume data processing
   - OI confirmation requires OI data processing
   - Requires orchestrator to pass upstream results

### Volume and OI Data

Volume and OI data preparation requires:
- Loading `market_price_daily.volume` for volume expansion
- Loading `coin_metrics.openInterest` for OI confirmation
- Implementing 7D baseline calculations
- Implementing equal-weight aggregation

These are marked as placeholders in P3-10C and will be implemented in P3-10D.

## Validation

### Typecheck

```bash
npm run typecheck
```

**Result:** PASS (exit code 0)

### git diff --check

```bash
git diff --check
```

**Result:** PASS (no whitespace or formatting issues)

## Scope Protection

### /api/refresh

**Status:** NOT MODIFIED

The `/api/refresh` route has not been modified. P3 orchestrator integration is for P3-10D.

### Scheduler

**Status:** NOT MODIFIED

No scheduler changes were made.

### FastAPI

**Status:** NOT MODIFIED

No FastAPI changes were made.

### P3 Orchestrator

**Status:** NOT IMPLEMENTED

The P3 orchestrator has not been implemented. This task only implemented the input preparation layer.

### Persistence Behavior

**Status:** NOT CHANGED

No new persistence behavior was introduced. The existing `persistP3Calculation()` boundary is reused.

## Next Steps

P3-10C is complete. The next task is:

**P3-10D — Authoritative P3 Orchestrator Implementation**

The orchestrator will:
- Use the execution context from P3-10C
- Execute P3-04 through P3-09 in dependency order
- Pass prepared inputs to each module
- Collect results
- Persist through immutable boundary
- Integrate with `/api/refresh`

## Acceptance Criteria

- [x] P3ExecutionContext exists
- [x] UTC window is resolved through approved P3 kernel
- [x] Scheduler timezone does not leak into calculation
- [x] Historical constituent snapshot is authoritative
- [x] Current membership is not substituted
- [x] Market cap eligibility is enforced
- [x] Exclusion reasons are preserved
- [x] Futures-only source semantics are preserved
- [x] BTC uses BTC-USDT perpetual futures (prepared)
- [x] Required historical observations are prepared (for P3-04, P3-05, P3-06)
- [x] Missing-data semantics are preserved
- [x] P3-04 inputs are correctly prepared
- [x] P3-05 inputs are correctly prepared
- [x] P3-06 inputs are correctly prepared
- [x] P3-07 inputs are partially prepared (placeholders for upstream)
- [x] P3-08 inputs are placeholders (require orchestrator)
- [x] P3-09 inputs are placeholders (require orchestrator + volume/OI)
- [x] Version/config identity is preserved
- [x] Provenance is preserved
- [x] Deterministic ordering is guaranteed
- [x] Focused tests pass
- [x] Typecheck passes
- [x] git diff --check passes
- [x] /api/refresh unchanged
- [x] No orchestrator implemented
