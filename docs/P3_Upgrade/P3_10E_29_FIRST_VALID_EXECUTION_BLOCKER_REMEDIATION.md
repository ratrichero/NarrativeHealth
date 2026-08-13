# P3-10E.29 — First Valid Execution Blocker Remediation

## 1. Executive Summary

P3-10E.29 remediated the three blockers discovered by P3-10E.28:

| Blocker | Stage | Root Cause | Remediation |
|---|---|---|---|
| A | P3-07 Leadership | `prepareLeadershipInputs()` had an empty `rsMap` placeholder; P3-06 RS values were never wired to Leadership inputs | Wire canonical P3-06 7D per-coin returns to Leadership inputs via orchestrator |
| B | P3-08 Regime | `prepareRegimeInputs()` queried ALL historical P3 records, including invalid artifact #1 (INSUFFICIENT_HISTORY), causing `breadthChange` and `relativeStrengthChange` to be null | Filter historical P3 queries to `availabilityState = "VALID"` only |
| C | P3-09 Rotation | `prepareRotationInputs()` derived `breadthMomentum` from corrupted historical breadth in artifact #1 | Filter historical P3 queries to `availabilityState = "VALID"` only; implement first-run bootstrap for Rotation when `breadthMomentum` is the only missing input |

**STATUS: PASS**

All three blockers have been remediated. The next controlled P3 execution should be able to produce the first VALID authoritative P3 artifact, assuming current input data is sufficient for all stages.

---

## 2. Files Modified

| File | Change Type | Description |
|---|---|---|
| `src/lib/p3/relative-strength.ts` | Modified | Added `constituentReturns` field to `RSWindowResult`; populated 7D per-coin returns in `calculateRelativeStrengthWindow()`; exposed `constituentReturns7d` in provenance |
| `src/lib/p3/preparation.ts` | Modified | Added `relativeStrengthData` parameter to `prepareLeadershipInputs()`; replaced empty `rsMap` placeholder with injected P3-06 data; added `availabilityState = "VALID"` filter to `prepareRegimeInputs()` historical query; added `availabilityState = "VALID"` filter to `prepareRotationInputs()` historical queries; added `firstRun` flag to `PreparedRotationInputs` |
| `src/lib/p3/orchestrator.ts` | Modified | Extracted P3-06 7D constituent returns from `relativeStrengthResult.provenance.constituentReturns7d` and passed them to `prepareLeadershipInputs()`; passed `rotationInputs.firstRun` to `rotationCompleteInputs` |
| `src/lib/p3/rotation.ts` | Modified | Added `firstRun?: boolean` to `RotationInputs`; implemented first-run bootstrap logic in `calculateRotation()` that allows missing `breadthMomentum` when `firstRun === true` and it is the only missing input; renormalizes weights excluding `breadthMomentum` |
| `src/lib/p3/__tests__/p3-10e-29-remediation.test.ts` | Created | 9 focused tests covering all three blockers and regression scenarios |

---

## 3. Blocker A — Leadership RS Wiring

### 3.1 Root Cause

`prepareLeadershipInputs()` in `src/lib/p3/preparation.ts:529` contained:

```typescript
// Load 7D relative strength (placeholder - needs RS calculation from P3-06)
// This will be populated by the orchestrator using P3-06 results
const rsMap = new Map<number, number>();
```

The orchestrator called `prepareLeadershipInputs()` but never populated `rsMap` with P3-06 results. As a result, all constituents had `relativeStrength7d: null`, causing Leadership to exclude all of them with reason `missing_or_invalid_relative_strength`.

### 3.2 Data Flow Fix

**Before:**
```text
P3-06 calculateRelativeStrengthResult()
  → produces narrative-level relativeStrength7d
  → DOES NOT produce per-coin returns
  → Leadership receives empty rsMap
  → All constituents excluded
```

**After:**
```text
P3-06 calculateRelativeStrengthWindow()
  → produces per-coin returns in constituentReturns map
  → calculateRelativeStrengthResult() exposes constituentReturns7d in provenance
  → Orchestrator extracts constituentReturns7d from relativeStrengthResult.provenance
  → Passes to prepareLeadershipInputs(relativeStrengthData)
  → Leadership preparation populates rsMap with canonical P3-06 values
  → Constituents receive valid relativeStrength7d
  → Leadership becomes VALID (with sufficient eligible constituents)
```

### 3.3 Changes

1. **`src/lib/p3/relative-strength.ts`**:
   - Added `constituentReturns: ReadonlyMap<number, number>` to `RSWindowResult` interface
   - In `calculateRelativeStrengthWindow()`, populated `constituentReturns` map with each eligible constituent's 7D return
   - Exposed `constituentReturns7d` in `P3CalculationResult.provenance`

2. **`src/lib/p3/preparation.ts`**:
   - Added `relativeStrengthData?: ReadonlyMap<number, number>` parameter to `prepareLeadershipInputs()`
   - Replaced empty `rsMap` with `relativeStrengthData ?? new Map<number, number>()`

3. **`src/lib/p3/orchestrator.ts`**:
   - Extracted `rsConstituentReturns` from `relativeStrengthResult.provenance?.constituentReturns7d`
   - Passed `rsConstituentReturns` to `prepareLeadershipInputs()`

### 3.4 Invariant

```text
P3-06 RS valid
        ↓
Leadership preparation receives same RS value
        ↓
constituent is not rejected for missing RS
```

No duplicate RS algorithm. No alternate data source. Leadership consumes canonical P3-06 output.

---

## 4. Blocker B — Corrupted Historical P3 Artifact

### 4.1 Root Cause

Production contains `p3_narrative_intelligence.id = 1` produced during failed P3-10E.11 execution. It contains:

```text
breadth = null
relative_strength_7d = null
availabilityState = INSUFFICIENT_HISTORY
```

`prepareRegimeInputs()` and `prepareRotationInputs()` queried ALL historical P3 records without filtering by `availabilityState`. Since artifact #1 existed, `historicalP3Data.length >= 1`, causing:

- `firstRun = false` (incorrect)
- `breadthChange = null` (because `breadth7dAgo` was null)
- `relativeStrengthChange = null` (because `rs7dAgo` was null)
- Regime returned `MISSING` (required inputs unavailable)
- Rotation `breadthMomentum = null` (because historical breadth was null)
- Rotation returned `MISSING`

### 4.2 Fix

**`src/lib/p3/preparation.ts`** — Added `eq(p3NarrativeIntelligence.availabilityState, "VALID")` filter to both historical P3 queries:

```typescript
// prepareRegimeInputs() — line 636
.where(
  and(
    eq(p3NarrativeIntelligence.narrativeId, narrativeId),
    eq(p3NarrativeIntelligence.availabilityState, "VALID"),  // NEW
    gte(p3NarrativeIntelligence.windowEnd, resolvedWindow.startTarget),
    lte(p3NarrativeIntelligence.windowEnd, resolvedWindow.endTarget)
  )
)

// prepareRotationInputs() — line 742
.where(
  and(
    eq(p3NarrativeIntelligence.narrativeId, narrativeId),
    eq(p3NarrativeIntelligence.availabilityState, "VALID"),  // NEW
    gte(p3NarrativeIntelligence.windowEnd, resolvedWindow.startTarget),
    lte(p3NarrativeIntelligence.windowEnd, resolvedWindow.endTarget)
  )
)
```

### 4.3 Historical P3 Eligibility Contract

Historical P3 data may only be used as a historical calculation baseline when the source artifact is:

```text
availabilityState = VALID
```

Invalid / incomplete / insufficient-history artifacts must NOT be treated as historical baselines.

| Artifact State | Eligible as Baseline |
|---|---|
| VALID | YES |
| INSUFFICIENT_HISTORY | NO |
| MISSING | NO |
| INVALID | NO |
| STALE | NO |

Artifact #1 (`availabilityState = INSUFFICIENT_HISTORY`) is correctly excluded.

---

## 5. Regime First-Run Semantics

### 5.1 Behavior

After filtering invalid historical P3 artifacts, if no VALID historical P3 baseline exists:

```text
firstRun = true
breadthChange = null
relativeStrengthChange = null
historicalP3BaselineAvailable = false
```

Regime must still classify using the six mandatory current inputs:

```text
health, healthChange, breadth, momentum, acceleration, relativeStrength
```

Do NOT fabricate:

```text
breadthChange = 0
relativeStrengthChange = 0
```

### 5.2 Provenance

Regime result provenance now correctly reflects first-run state:

```typescript
{
  firstRun: true,
  historicalP3BaselineAvailable: false,
  breadthChange: null,
  relativeStrengthChange: null
}
```

### 5.3 Verification

Tested with `classifyRegime()` directly:
- `firstRun: true` with no VALID historical P3 → `historicalP3BaselineAvailable: false`, `breadthChange: null`, `relativeStrengthChange: null`
- Regime can still return VALID when current inputs match a classification rule

---

## 6. Rotation First-Run Bootstrap

### 6.1 Problem

`prepareRotationInputs()` derived `breadthMomentum` from historical P3 breadth. With no VALID historical baseline, `breadthMomentum = null`. Rotation requires 5 inputs:

```text
healthMomentum, breadthMomentum, relativeStrength, volumeExpansion, oiConfirmation
```

With `breadthMomentum = null`, Rotation returned `MISSING`.

### 6.2 Solution

Implemented minimal first-run bootstrap in `calculateRotation()` (`src/lib/p3/rotation.ts`):

**Conditions:**
- `inputs.firstRun === true`
- Exactly 1 missing input: `breadthMomentum`
- All other 4 inputs are valid (non-null, finite, 0-100)

**Behavior:**
1. Compute score using only the 4 available inputs
2. Renormalize weights to sum to 1.0 (excluding `breadthMomentum`'s 0.2 weight)
3. Classify using existing thresholds
4. Return `availabilityState: "VALID"`
5. Mark provenance with `firstRun: true` and `missingInputs: ["breadthMomentum"]`

**Renormalized weights:**
```text
healthMomentum: 0.3 / 0.8 = 0.375
relativeStrength: 0.2 / 0.8 = 0.25
volumeExpansion: 0.15 / 0.8 = 0.1875
oiConfirmation: 0.15 / 0.8 = 0.1875
```

### 6.3 Non-First-Run Behavior Unchanged

When `firstRun !== true` or when `breadthMomentum` is available, Rotation uses the original 5-input weighted formula with original weights:

```text
healthMomentum: 0.3
breadthMomentum: 0.2
relativeStrength: 0.2
volumeExpansion: 0.15
oiConfirmation: 0.15
```

### 6.4 Fallback in Orchestrator

The orchestrator already had a fallback for Rotation's `relativeStrength`:

```typescript
const relativeStrength = rotationInputs.relativeStrength != null
  ? normalizeRelativeStrength(rotationInputs.relativeStrength)
  : (() => {
      const rsValue = extractMetricValue(relativeStrengthResult, "relativeStrength_7d");
      return rsValue != null ? normalizeRelativeStrength(rsValue) : null;
    })();
```

This fallback remains intact. With our changes, `rotationInputs.relativeStrength` will now be populated from VALID historical P3 data when available.

---

## 7. Test Matrix

### 7.1 New Tests (`p3-10e-29-remediation.test.ts`)

| # | Test | Result |
|---|---|---|
| 1 | P3-06 valid RS reaches P3-07 and prevents false `missing_or_invalid_relative_strength` | PASS |
| 2 | All 7 AI constituents receive valid RS where available | PASS |
| 3 | Missing RS still excludes constituent when RS data is absent | PASS |
| 4 | Regime first-run when no VALID historical P3 exists | PASS |
| 5 | Regime does not fabricate null historical changes from invalid artifact | PASS |
| 6 | Rotation becomes VALID on first run when breadthMomentum is the only missing input | PASS |
| 7 | Rotation remains MISSING when non-breadthMomentum input is missing even on first run | PASS |
| 8 | Rotation renormalizes weights when breadthMomentum is missing on first run | PASS |
| 9 | Rotation normal path still works when all inputs present | PASS |

### 7.2 Existing Tests — No New Regressions

| Suite | Tests | Result |
|---|---|---|
| `momentum.test.ts` | All | PASS |
| `relative-strength.test.ts` | All | PASS |
| `orchestrator-gate.test.ts` | All | PASS |
| `regime.test.ts` | All | PASS |
| `leadership.test.ts` | All | PASS |

### 7.3 Pre-Existing Failures (Not Introduced by P3-10E.29)

| Suite | Failure | Count |
|---|---|---|
| `rotation.test.ts` | RS normalization tests expect different `normalizeRelativeStrength` behavior | 6 |
| `membership.test.ts` | `db.select is not a function` (mock issue) | 1 |
| `preparation.test.ts` | `snapshotId` type mismatch | 1 |
| `breadth.test.ts` | `bullishRatio`/`strongBreadth` null vs computed | 1 |

**Total pre-existing failures: 9**
**New failures introduced by P3-10E.29: 0**

---

## 8. Verification Results

### 8.1 Typecheck

```bash
npx tsc --noEmit
```

**Result: PASS** (no errors)

### 8.2 Git Diff Check

```bash
git diff --check
```

**Result: PASS** (no whitespace errors)

### 8.3 Focused P3 Tests

```bash
npx jest src/lib/p3/__tests__/momentum.test.ts src/lib/p3/__tests__/relative-strength.test.ts src/lib/p3/__tests__/orchestrator-gate.test.ts src/lib/p3/__tests__/regime.test.ts src/lib/p3/__tests__/leadership.test.ts --no-coverage --runInBand
```

**Result: 112 passed, 0 failed**

### 8.4 New Remediation Tests

```bash
npx jest src/lib/p3/__tests__/p3-10e-29-remediation.test.ts --no-coverage --runInBand
```

**Result: 9 passed, 0 failed**

### 8.5 Full P3 Test Suite

```bash
npx jest src/lib/p3/__tests__ --no-coverage --runInBand
```

**Result: 277 passed, 9 failed (all pre-existing)**

---

## 9. Production Mutation Audit

| Audit Item | Status |
|---|---|
| Production data modified | **NONE** |
| Production schema modified | **NONE** |
| Migrations created | **NONE** |
| `/api/refresh` modified | **NONE** |
| Scheduler modified | **NONE** |
| Thresholds/configuration modified | **NONE** |
| Correction ledger modified | **NONE** |
| Snapshot 7 modified | **NONE** |
| Intelligence #1 modified | **NONE** |
| Authoritative P3 executed in production | **NONE** |
| New P3 artifacts created | **NONE** |

**Production mutations: 0**

---

## 10. Remaining Blockers

### 10.1 Pre-Existing Test Failures (Not Blocking Production)

The following test failures existed before P3-10E.29 and are NOT addressed by this task:

1. **`rotation.test.ts` — RS normalization tests (6 failures)**
   - Tests expect `normalizeRelativeStrength()` to map -10% RS → 0, -5% → 25, 0% → 50, +5% → 75, +10% → 100
   - Current implementation produces different values (e.g., -10% → 49.5)
   - This is a pre-existing discrepancy between test expectations and implementation
   - **Not introduced by P3-10E.29**

2. **`membership.test.ts` — `db.select is not a function` (1 failure)**
   - Mock setup issue in test file
   - **Not introduced by P3-10E.29**

3. **`preparation.test.ts` — `snapshotId` type mismatch (1 failure)**
   - Test expects `snapshotId` to be `string`, but it is `object`
   - **Not introduced by P3-10E.29**

4. **`breadth.test.ts` — `bullishRatio`/`strongBreadth` null vs computed (1 failure)**
   - Test expects computed ratios when health is unavailable, but implementation returns null
   - **Not introduced by P3-10E.29**

### 10.2 Production Execution Readiness

The three production blockers from P3-10E.28 have been remediated:

| Blocker | Status |
|---|---|
| Leadership RS wiring | **FIXED** |
| Invalid historical P3 filtering | **FIXED** |
| Rotation first-run bootstrap | **FIXED** |

**The next controlled P3 execution (AI/7D/2026-08-12 or later) should be able to proceed past the persistence gate, assuming:**
- Sufficient market data exists for all constituents
- BTC benchmark is available
- All upstream stages (P3-04 through P3-06) return VALID
- At least 3 eligible constituents exist for Leadership

---

## 11. Before/After Data Flow

### 11.1 P3-06 → P3-07 Leadership

**Before:**
```text
calculateRelativeStrengthResult()
  → metrics.relativeStrength7d (narrative-level only)
  → provenance.windows (no per-coin returns)
  ↓
prepareLeadershipInputs()
  → rsMap = new Map<number, number>()  // EMPTY
  ↓
calculateLeadershipResult()
  → All constituents: missing_or_invalid_relative_strength
  → INSUFFICIENT_HISTORY
```

**After:**
```text
calculateRelativeStrengthWindow()
  → constituentReturns: Map<coinId, 7D_return>
  ↓
calculateRelativeStrengthResult()
  → provenance.constituentReturns7d: Map<coinId, 7D_return>
  ↓
orchestrator extracts constituentReturns7d
  ↓
prepareLeadershipInputs(relativeStrengthData)
  → rsMap populated with canonical P3-06 values
  ↓
calculateLeadershipResult()
  → Constituents have valid relativeStrength7d
  → VALID (if >= 3 eligible)
```

### 11.2 Historical P3 Validity Filtering

**Before:**
```text
prepareRegimeInputs() / prepareRotationInputs()
  → SELECT * FROM p3_narrative_intelligence
  → WHERE narrativeId = ? AND windowEnd BETWEEN ? AND ?
  → Includes artifact #1 (INSUFFICIENT_HISTORY)
  → firstRun = false (incorrect)
  → breadthChange = null, relativeStrengthChange = null
  → Regime: MISSING, Rotation: MISSING
```

**After:**
```text
prepareRegimeInputs() / prepareRotationInputs()
  → SELECT * FROM p3_narrative_intelligence
  → WHERE narrativeId = ? AND availabilityState = 'VALID' AND windowEnd BETWEEN ? AND ?
  → Excludes artifact #1
  → firstRun = true (correct when no VALID baseline)
  → breadthChange = null, relativeStrengthChange = null (correct)
  → Regime: classifies with 6 current inputs
  → Rotation: first-run bootstrap or uses VALID historical baseline
```

---

## 12. Success Criteria Checklist

- [x] Leadership receives canonical P3-06 RS
- [x] Empty `rsMap` removed
- [x] Leadership no longer falsely returns INSUFFICIENT_HISTORY (when RS is available)
- [x] Invalid historical P3 artifacts are excluded from historical baseline selection
- [x] Intelligence #1 remains untouched
- [x] Snapshot 7 remains untouched
- [x] Correction ledger remains untouched
- [x] Regime first-run semantics remain correct
- [x] No null → zero conversion
- [x] Rotation does not consume corrupted historical breadth
- [x] Valid historical P3 behavior remains unchanged
- [x] Focused tests pass (9/9 new tests)
- [x] Typecheck passes
- [x] Diff check passes
- [x] Production writes = 0
- [x] Production mutations = 0

---

## 13. Next Steps

1. **Execute controlled P3-10E.30** for AI/7D with the remediated code
2. **Monitor** P3-07 Leadership, P3-08 Regime, and P3-09 Rotation availability states
3. **Address pre-existing test failures** in separate task (rotation normalization, membership mock, preparation snapshotId, breadth null handling)
4. **Consider adding pre-execution validation** that checks for corrupted historical data before running the orchestrator

---

*P3-10E.29 completed. All three production blockers remediated. No production data modified.*
