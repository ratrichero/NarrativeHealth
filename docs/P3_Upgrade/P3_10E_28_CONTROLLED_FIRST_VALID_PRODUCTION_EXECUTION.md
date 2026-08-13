# P3-10E.28 — Controlled First Valid Production Execution

## 1. Executive Summary

P3-10E.28 attempted the first authoritative P3 production execution for:
- **Narrative:** AI
- **Window:** 7D
- **WindowEnd:** 2026-08-11T00:00:00Z
- **CalculationMode:** observed

**STATUS: BLOCKED**

The execution failed at the persistence gate due to three mandatory stages returning non-VALID availability states. These are pre-existing bugs in the P3 pipeline, not caused by P3-10E.25/26 adaptive window changes.

## 2. Execution Metadata

| Field | Value |
|---|---|
| narrative | AI |
| narrative_id | 1 |
| window | 7D |
| window_end | 2026-08-11T00:00:00Z |
| membership_snapshot_id | 2 |
| calculation_mode | observed |
| execution_timestamp | 2026-08-11T22:52:00Z |

## 3. Pre-Flight Verification

### Membership: PASS

| Check | Result |
|---|---|
| Resolver returns AVAILABLE | PASS |
| Effective snapshot | 2 |
| Member count | 7 |
| Members | [1, 4, 5, 10, 11, 12, 22] |
| No new snapshot created | PASS |
| Snapshot 7 superseded | PASS (0 members) |
| Correction ledger 7 -> 2 | PASS |

### Data Availability: PASS

| Data | Status |
|---|---|
| market_price_daily (7D window) | 8 records/day |
| coin_metrics (7D window) | 14 records/day |
| health_scores (7D window) | 7 records/day |
| narrative_health (7D window) | 8 records (2026-08-03 to 2026-08-10) |
| BTC benchmark (coin_id=17) | PASS |

### Stage Availability (Expected)

| Stage | Expected | Actual | Result |
|---|---|---|---|
| P3-04 Breadth | VALID | VALID | PASS |
| P3-05 Momentum | VALID | VALID | PASS |
| P3-06 Relative Strength | VALID | VALID | PASS |
| P3-07 Leadership | VALID | INSUFFICIENT_HISTORY | FAIL |
| P3-08 Regime | VALID | MISSING | FAIL |
| P3-09 Rotation | VALID | MISSING | FAIL |

## 4. Stage Results

### P3-04 Breadth: VALID

- availabilityState: VALID
- Constituents: 7 eligible
- No issues detected

### P3-05 Momentum: VALID

- 1D: VALID
- 3D: VALID
- 7D: VALID
- 14D: MISSING (optional, not a blocker)
- acceleration: VALID
- stageAvailability: VALID

### P3-06 Relative Strength: VALID

- 1D: VALID
- 3D: VALID
- 7D: VALID
- 14D: MISSING (optional, not a blocker)
- BTC benchmark: coin_id=17, BTCUSDT
- stageAvailability: VALID

### P3-07 Leadership: INSUFFICIENT_HISTORY (BLOCKER)

**Root Cause:** `prepareLeadershipInputs()` in `src/lib/p3/preparation.ts` line 529 has an empty `rsMap` placeholder:

```typescript
// Load 7D relative strength (placeholder - needs RS calculation from P3-06)
// This will be populated by the orchestrator using P3-06 results
const rsMap = new Map<number, number>();
```

The orchestrator does NOT populate `rsMap` with P3-06 results before calling `calculateLeadershipResult()`. As a result, all 7 constituents have `relativeStrength7d = null`, causing all to be excluded with reason "missing_or_invalid_relative_strength". With 0 eligible constituents (< 3 minimum), Leadership returns `INSUFFICIENT_HISTORY`.

**Evidence:** Leadership preparation code at `src/lib/p3/preparation.ts:528-529`

### P3-08 Regime: MISSING (BLOCKER)

**Root Cause:** `prepareRegimeInputs()` loads historical P3 data from `p3_narrative_intelligence` to calculate `breadthChange` and `relativeStrengthChange`. The existing record (id=1) was created by a previous failed execution (P3-10E.11) and contains `breadth=null` and `relative_strength_7d=null`.

Since historical P3 data exists, `firstRun=false`. Regime requires `breadthChange` and `relativeStrengthChange` for non-first-run classification. But since the historical data has null values, these become null, causing Regime to return MISSING.

**Evidence:**
- Existing P3 intelligence record (id=1): `breadth=None`, `relative_strength_7d=None`
- `prepareRegimeInputs()` at `src/lib/p3/preparation.ts:651-667`

### P3-09 Rotation: MISSING (BLOCKER)

**Root Cause:** `prepareRotationInputs()` calculates `breadthMomentum` from historical P3 breadth data. Since the existing P3 record has `breadth=null`, `breadthMomentum` becomes null. Rotation requires all 5 inputs (healthMomentum, breadthMomentum, relativeStrength, volumeExpansion, oiConfirmation), so it returns MISSING.

**Evidence:**
- `prepareRotationInputs()` at `src/lib/p3/preparation.ts:728-755`
- Historical P3 breadth is null

## 5. Persistence Verification

**Persistence was NOT reached.**

`validateMandatoryStages()` threw `P3InsufficientDataError` at `src/lib/p3/orchestrator.ts:157`:

```
P3 calculation cannot be persisted: mandatory stages not VALID: 
P3-07 Leadership=INSUFFICIENT_HISTORY, 
P3-08 Regime=MISSING, 
P3-09 Rotation=MISSING
```

## 6. Atomicity Verification

**PASS** - No partial artifacts were created. The execution failed before any database writes occurred.

## 7. Immutability Verification

**PASS** - No historical artifacts were modified:

| Artifact | Status |
|---|---|
| Snapshot 2 | Unchanged (7 members) |
| Snapshot 7 | Unchanged (0 members, superseded) |
| Correction ledger | Unchanged (7 -> 2) |
| P3 intelligence #1 | Unchanged (availability=INSUFFICIENT_HISTORY) |

## 8. P0-P2 Regression Check

**PASS** - No P0-P2 tables were modified during the failed execution.

## 9. Root Cause Analysis

### Blocker 1: Leadership RS Data Flow

**File:** `src/lib/p3/preparation.ts:528-529`

The `prepareLeadershipInputs()` function has a placeholder `rsMap` that is never populated with P3-06 Relative Strength results. The orchestrator calls `prepareLeadershipInputs()` before `calculateLeadershipResult()` but does not inject RS values in between.

**Impact:** Leadership always returns INSUFFICIENT_HISTORY because no constituent has valid `relativeStrength7d`.

### Blocker 2: Regime Historical Baseline Pollution

**File:** `src/lib/p3/preparation.ts:651-667`

The existing P3 intelligence record (id=1) was created by a failed execution and contains null values for `breadth` and `relative_strength_7d`. When `prepareRegimeInputs()` loads this record to calculate `breadthChange` and `relativeStrengthChange`, it gets null values, causing Regime to return MISSING.

**Impact:** Regime cannot classify because historical baseline is corrupted.

### Blocker 3: Rotation Breadth Momentum Dependency

**File:** `src/lib/p3/preparation.ts:728-755`

`prepareRotationInputs()` calculates `breadthMomentum` from historical P3 breadth data. Since the existing record has null breadth, `breadthMomentum` is null, causing Rotation to return MISSING.

**Impact:** Rotation cannot compute because it depends on corrupted historical breadth.

## 10. Blockers Summary

| # | Blocker | Stage | Root Cause | Fix Required |
|---|---|---|---|---|
| 1 | Leadership RS not wired | P3-07 | `prepareLeadershipInputs` has empty `rsMap` placeholder | Wire P3-06 RS results to leadership inputs in orchestrator |
| 2 | Regime historical baseline null | P3-08 | Existing P3 record (id=1) has null breadth/RS from failed execution | Either fix existing record or handle null historical values in Regime |
| 3 | Rotation breadthMomentum null | P3-09 | Historical P3 breadth is null | Same as #2 |

## 11. What Would Need to Happen to Unblock

### Option A: Fix Data Flow (Recommended)

1. **Fix Leadership RS wiring:** In `src/lib/p3/orchestrator.ts`, after computing `relativeStrengthResult`, inject RS values into `leadershipInputs.constituents` before calling `calculateLeadershipResult()`.

2. **Fix Regime/Rotation null handling:** In `prepareRegimeInputs()` and `prepareRotationInputs()`, handle the case where historical P3 data has null values. For Regime, if `breadthChange` or `relativeStrengthChange` is null but current inputs are valid, consider allowing classification with available inputs. For Rotation, if `breadthMomentum` is null, either compute from current P3-04 result or allow rotation with available inputs.

### Option B: Clean Slate

1. Delete the corrupted P3 intelligence record (id=1) and its associated snapshots.
2. Re-run execution with `firstRun=true` semantics.
3. This would require `prepareRegimeInputs()` to correctly detect first-run when no valid historical data exists.

### Option C: Manual Baseline Injection

1. Manually create a valid P3 intelligence record for a prior date with correct breadth and RS values.
2. This would provide a clean historical baseline for Regime and Rotation.

## 12. Production Safety

| Metric | Value |
|---|---|
| Production writes | 0 |
| Production mutations | 0 |
| New P3 artifacts created | 0 |
| P0-P2 tables modified | 0 |
| Historical artifacts modified | 0 |

## 13. Final Decision

**P3-10E.28: BLOCKED**

The execution cannot succeed due to three pre-existing bugs in the P3 pipeline:

1. **Leadership:** RS values not wired from P3-06 to P3-07
2. **Regime:** Corrupted historical P3 baseline (null breadth/RS)
3. **Rotation:** Depends on null historical breadth

These bugs are NOT related to P3-10E.25/26 adaptive window changes. They existed before and prevent any valid P3 execution from succeeding.

## 14. Next Steps

1. **Do NOT retry execution** without fixing the root causes.
2. **Fix Blocker 1:** Wire RS values from P3-06 to Leadership inputs in orchestrator.
3. **Fix Blocker 2:** Handle null historical values in Regime and Rotation preparation, or clean the corrupted P3 record.
4. **Re-run P3-10E.28** after fixes are implemented and tested.
5. **Consider adding a pre-execution validation step** that checks for corrupted historical data before running the orchestrator.

## 15. Files Created

| File | Purpose |
|---|---|
| `src/lib/p3/__tests__/p3-10e-28-execution.test.ts` | Execution verification test (temporary, can be removed) |

## 16. Test Results

| Test | Result |
|---|---|
| Pre-flight checks | PASS |
| P3-04 Breadth | VALID |
| P3-05 Momentum | VALID |
| P3-06 Relative Strength | VALID |
| P3-07 Leadership | INSUFFICIENT_HISTORY (BLOCKER) |
| P3-08 Regime | MISSING (BLOCKER) |
| P3-09 Rotation | MISSING (BLOCKER) |
| Persistence | NOT REACHED |
| Atomicity | PRESERVED |
| Typecheck | PASS |
| Git diff check | PASS |
