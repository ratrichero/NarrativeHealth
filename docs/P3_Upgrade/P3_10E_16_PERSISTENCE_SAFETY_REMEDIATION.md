# P3-10E.16 Persistence Safety Remediation

## Status

```text
P3-10E.16 STATUS: PASS
```

---

## 1. Root Cause

From P3-10E.15, the root cause of the invalid historical artifact (`p3_narrative_intelligence.id=1` with `membership_snapshot_id=7`) was:

```text
The orchestrator persistently writes P3 results
without gating on overall availability state.

persistP3Calculation()
is called unconditionally after aggregateP3Results(),
regardless of whether any mandatory P3 stage
(P3-04 through P3-09) succeeded.
```

In P3-10E.11, the pre-refactor resolver returned an empty 0-member snapshot 7 as `AVAILABLE`. All 6 stages returned `INSUFFICIENT_HISTORY`. The orchestrator persisted the result anyway.

---

## 2. Orchestrator Gate

**File**: `src/lib/p3/orchestrator.ts`

Added an exported `validateMandatoryStages()` function that inspects the **actual stage results** (not the aggregated result) before persistence:

```typescript
export function validateMandatoryStages(
  breadthResult: P3CalculationResult,
  momentumResult: P3CalculationResult,
  relativeStrengthResult: P3CalculationResult,
  leadershipResult: P3CalculationResult,
  regimeResult: P3CalculationResult,
  rotationResult: P3CalculationResult,
): void {
  const stages = [
    { name: "P3-04 Breadth", result: breadthResult },
    { name: "P3-05 Momentum", result: momentumResult },
    { name: "P3-06 Relative Strength", result: relativeStrengthResult },
    { name: "P3-07 Leadership", result: leadershipResult },
    { name: "P3-08 Regime", result: regimeResult },
    { name: "P3-09 Rotation", result: rotationResult },
  ];

  const failedStages = stages.filter(
    ({ result }) => result.availabilityState !== "VALID"
  );

  if (failedStages.length > 0) {
    const details = failedStages
      .map((s) => `${s.name}=${s.result.availabilityState}`)
      .join(", ");
    throw new P3InsufficientDataError(
      `P3 calculation cannot be persisted: mandatory stages not VALID: ${details}`
    );
  }
}
```

The orchestrator calls `validateMandatoryStages()` immediately before `persistP3Calculation()`:

```typescript
const aggregateResult = aggregateP3Results(...);

// PERSISTENCE GATE: ALL mandatory stages must be VALID before persistence.
validateMandatoryStages(
  breadthResult,
  momentumResult,
  relativeStrengthResult,
  leadershipResult,
  regimeResult,
  rotationResult
);

const persistence = await persistP3Calculation({...});
```

**Behavior**:
- Any stage with `availabilityState !== "VALID"` → `P3InsufficientDataError` thrown
- `persistP3Calculation()` is never reached
- No database writes occur for incomplete calculations

---

## 3. Persistence Defense-in-Depth

**File**: `src/lib/p3/persistence.ts`

Added `P3PersistenceError` class and a guard at the top of `persistP3Calculation()`:

```typescript
export class P3PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "P3PersistenceError";
  }
}
```

```typescript
export async function persistP3Calculation(payload: P3PersistencePayload): Promise<P3PersistenceOutcome> {
  const { context, result } = payload;
  const identity = calculationIdentity(context);

  // Defense-in-depth: reject incomplete authoritative calculations
  // even if a caller bypasses the orchestrator gate.
  if (result.availabilityState !== "VALID") {
    throw new P3PersistenceError(
      `Refusing to persist P3 result with availabilityState=${result.availabilityState} for identity=${identity}`
    );
  }
  ...
```

**Behavior**:
- `availabilityState === "VALID"` → persistence proceeds
- Any other state → `P3PersistenceError` thrown, no transaction entered, zero DB mutations

---

## 4. Tests

### Test 1 — Breadth failure
`src/lib/p3/__tests__/orchestrator-gate.test.ts`
- `validateMandatoryStages` called with P3-04 Breadth = `INSUFFICIENT_HISTORY`
- Throws `P3InsufficientDataError`
- Error message contains `P3-04 Breadth=INSUFFICIENT_HISTORY`

### Test 2 — Momentum failure
- P3-05 Momentum = `MISSING`
- Throws `P3InsufficientDataError`
- Error message contains `P3-05 Momentum=MISSING`

### Test 3 — Relative Strength failure
- P3-06 Relative Strength = `INVALID`
- Throws `P3InsufficientDataError`
- Error message contains `P3-06 Relative Strength=INVALID`

### Test 4 — Leadership failure
- P3-07 Leadership = `INSUFFICIENT_HISTORY`
- Throws `P3InsufficientDataError`
- Error message contains `P3-07 Leadership=INSUFFICIENT_HISTORY`

### Test 5 — Regime failure
- P3-08 Regime = `MISSING`
- Throws `P3InsufficientDataError`
- Error message contains `P3-08 Regime=MISSING`

### Test 6 — Rotation failure
- P3-09 Rotation = `INVALID`
- Throws `P3InsufficientDataError`
- Error message contains `P3-09 Rotation=INVALID`

### Test 7 — Persistence defense (direct `persistP3Calculation` call)
`src/lib/p3/__tests__/persistence.test.ts`
- Called with `availabilityState = "INSUFFICIENT_HISTORY"` → `P3PersistenceError`, `db.transaction` not called
- Called with `availabilityState = "MISSING"` → `P3PersistenceError`, `db.transaction` not called
- Called with `availabilityState = "INVALID"` → `P3PersistenceError`, `db.transaction` not called

### Test 8 — Complete execution persists
- All 6 stages = `VALID`
- `validateMandatoryStages()` does not throw
- `persistP3Calculation()` succeeds, returns `{ intelligenceId: 99, inserted: true }`

### Additional tests
- Multiple failures reported in single error message
- `STALE`, `NOT_APPLICABLE`, `AMBIGUOUS` states all rejected
- Existing idempotency test updated (was using `MISSING`, now uses `VALID`)
- `membership-remediation.test.ts` (from P3-10E.13) still passes

---

## 5. Regression Results

### Typecheck

```text
npx tsc --noEmit   -> exit code 0 (PASS)
```

### Focused P3 Tests

```text
npx jest src/lib/p3/__tests__/persistence.test.ts
src/lib/p3/__tests__/orchestrator-gate.test.ts
src/lib/p3/__tests__/membership-remediation.test.ts
--no-coverage --runInBand

Test Suites: 3 passed, 3 total
Tests:       29 passed, 29 total
```

### Full Test Suite

```text
Test Suites: 4 failed, 20 passed, 24 total
Tests:       9 failed, 326 passed, 335 total
```

**Pre-existing failures (NOT regressions)**:

| Test File | Failure | Root Cause (Pre-existing) |
|-----------|---------|--------------------------|
| `rotation.test.ts` (6) | `normalizeRelativeStrength(-0.10)` returns `49.5` not `0` | P3-10A normalization math uses `health + rs * 100` formula, not the simple `50 + rs * 500` the test expects. Pre-dates P3-10E.16. |
| `breadth.test.ts` (1) | `bullishRatio` null when `availabilityState: "MISSING"` | Breadth calculation returns null metrics when availability is MISSING. Test expects numeric ratio. Pre-dates P3-10E.16. |
| `preparation.test.ts` (1) | `typeof provenance.snapshotId` is "object" not "string" | Snapshot ID passed as numeric object, not string. Pre-dates P3-10E.16. |
| `membership.test.ts` (1) | `db.select is not a function` | Test mock setup issue (`jest.mock("@/db")`). Pre-dates P3-10E.16. |

**No regressions introduced.** All 9 failures are in test files I did not modify, testing logic I did not change.

---

## 6. Production Safety Verification

READ-ONLY forensic audit (`backend/forensic_snapshot7_full.py`) confirmed zero mutations:

| Table | Before | After | Status |
|-------|--------|-------|--------|
| `p3_narrative_intelligence` | 1 record (id=1) | 1 record (id=1) | ✅ Unchanged |
| `p3_constituent_snapshots` | 1 record (id=1) | 1 record (id=1) | ✅ Unchanged |
| `p3_constituent_snapshot_members` | 0 rows | 0 rows | ✅ Unchanged |
| `p3_leadership_members` (id=1) | 0 rows | 0 rows | ✅ Unchanged |
| `narrative_membership_snapshots` | 6 snapshots | 6 snapshots | ✅ Unchanged |
| `narrative_membership_events` | 0 events | 0 events | ✅ Unchanged |

**No production data was created, modified, or deleted.**

The READ-ONLY resolver verification (`backend/verify_resolver_readonly_0811.py`) also confirmed:
- Snapshots: 6 before, 6 after (no new snapshots)
- Mutation check: PASS — zero database mutations

---

## 7. Remaining Snapshot-7 Status

Snapshot 7 remains unchanged:

```text
id=7, narrative_id=1, window_end=2026-08-11, member_count=0
source=membership_event_ledger, provenance={eventCount: 0, coverageStart: 2026-08-10T09:09:44.017Z}
```

- **NOT modified** (immutability respected)
- **NOT deleted**
- **NOT updated**
- Remains as an invalid historical artifact in `narrative_membership_snapshots`
- `p3_narrative_intelligence.id=1` still references it in `membership_snapshot_id`

The refactored resolver (P3-10E.13, already deployed) will **never select snapshot 7 as authoritative** because it anchors on `coverage_start` (2026-08-10T09:09:44), not `window_end`. Snapshot 2 (7 members) is the correct baseline.

The correction ledger (`p3_historical_corrections`) is **NOT created** in this task. See Section 8 for the next step.

---

## 8. Next Recommended Step

**After P3-10E.16 PASS** — Stop and report.

**Recommended next task: P3-10E.17 Corrective Correction Ledger** (requires owner approval):

1. Create `p3_historical_corrections` table (migration 0012, design from P3-10E.15 Section 7.1)
2. Insert correction record: `original_intelligence_id=1, original_snapshot_id=7, corrected_snapshot_id=2`
3. Add read-layer helper `resolveEffectiveMembership(intelligence_id)`
4. Add integration test for correction-aware lookup

**What P3-10E.16 does NOT do**:
- Does not create correction ledger
- Does not modify snapshot 7
- Does not execute P3 production orchestrator
- Does not modify P0-P2 logic
- Does not modify schema
- Does not modify `/api/refresh`

---

## 9. Code Changes Summary

### Modified Files

| File | Change | Lines Added |
|------|--------|-------------|
| `src/lib/p3/orchestrator.ts` | Added `validateMandatoryStages()` export + gate call | ~35 |
| `src/lib/p3/persistence.ts` | Added `P3PersistenceError` class + availability guard | ~10 |
| `src/lib/p3/__tests__/persistence.test.ts` | Updated idempotency test, added defense-in-depth tests | ~50 |

### New Files

| File | Description |
|------|-------------|
| `src/lib/p3/__tests__/orchestrator-gate.test.ts` | Tests 1-6 + edge cases for `validateMandatoryStages` |
| `docs/P3_Upgrade/P3_10E_16_PERSISTENCE_SAFETY_REMEDIATION.md` | This document |

### Unmodified (Confirmed)

| File | Reason |
|------|--------|
| `src/lib/p3/membership.ts` | Resolver already fixed in P3-10E.13 |
| `src/lib/p3/availability.ts` | No changes needed |
| `/api/refresh` | Not touched |
| P0-P2 logic | Not touched |
| Schema (`src/db/schema.ts`) | Not touched |
| Production database | Not touched |

---

## 10. Final Status

```text
P3-10E.16 STATUS: PASS
```

- ✅ Orchestrator gate: `validateMandatoryStages()` rejects non-VALID stages before persistence
- ✅ Persistence defense-in-depth: `persistP3Calculation()` rejects non-VALID results
- ✅ All 8 required tests pass (Tests 1-8)
- ✅ 29/29 focused tests pass
- ✅ Typecheck: clean (exit code 0)
- ✅ No regressions (9 pre-existing failures documented, 0 new failures)
- ✅ Production safety: zero mutations confirmed via READ-ONLY forensic audit
- ✅ Snapshot 7: unchanged, unmodified, undeleted
