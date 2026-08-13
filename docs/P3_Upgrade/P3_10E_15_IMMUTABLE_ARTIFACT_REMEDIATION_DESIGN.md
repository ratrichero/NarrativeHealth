# P3-10E.15 Immutable Historical Artifact Remediation Design

## Status

```text
P3-10E.15 STATUS: DESIGN PASS
```

---

## 1. Persistence Boundary Audit

### 1.1 Orchestrator Control Flow

From `src/lib/p3/orchestrator.ts`, `runP3AuthoritativeExecution()`:

```text
Step 1: createP3ExecutionContext()
  -> calls resolveP3Membership(narrativeId, windowEnd)
  -> if membership.availability != "AVAILABLE" -> throw P3InsufficientDataError
  (NOTE: pre-P3-10E.13, the resolver returned AVAILABLE for 0-member snapshot 7)

Step 2: Load configuration (regime/threshold configs)

Step 3: P3-04 Breadth (calculateBreadthResult)
  -> 0 constituents -> availabilityState = INSUFFICIENT_HISTORY

Step 4: P3-05 Momentum (calculateP3MomentumResult)
  -> 0 constituents -> availabilityState = INSUFFICIENT_HISTORY

Step 5: P3-06 Relative Strength (calculateRelativeStrengthResult)
  -> 0 constituents -> availabilityState = INSUFFICIENT_HISTORY

Step 6: P3-07 Leadership (calculateLeadershipResult)
  -> 0 constituents -> availabilityState = INSUFFICIENT_HISTORY

Step 7: P3-08 Regime (calculateRegimeResult)
  -> propagateAvailability of upstream = INSUFFICIENT_HISTORY

Step 8: P3-09 Rotation (calculateRotationResult)
  -> insufficient inputs -> availabilityState = MISSING

Step 9: aggregateP3Results()
  -> overallAvailability = INSUFFICIENT_HISTORY (firstUnavailable propagation)

Step 10: persistP3Calculation(...)  <- UNCONDITIONAL CALL
```

### 1.2 Which Stage Caused Persistence?

**Neither P3-04 through P3-09 stages.** Persistence is called by the **orchestrator** at line 303, after aggregation. The orchestrator has no guard on `aggregateResult.availabilityState`.

### 1.3 Was Persistence Invoked After a Failed/Insufficient Stage?

**Yes.** All 6 modules (P3-04 through P3-09) returned non-VALID states (INSUFFICIENT_HISTORY or MISSING). The aggregated `overallAvailability` was `INSUFFICIENT_HISTORY`. Despite this, `persistP3Calculation` was called unconditionally.

### 1.4 Does `persistP3Calculation()` Enforce "All Stages PASS"?

**No.** `persistP3Calculation()` (src/lib/p3/persistence.ts, lines 42-130) accepts a `P3CalculationResult` and persists it regardless of `availabilityState`. It writes `result.availabilityState` into the database as-is. There is no validation that `availabilityState === "VALID"`.

### 1.5 Does the Orchestrator Distinguish Failure Types?

The orchestrator computes `overallAvailability` but does NOT distinguish between:
- **Calculation failure** (throw)
- **Insufficient data** (return result with availabilityState = INSUFFICIENT_HISTORY/MISSING/INVALID)
- **Successful calculation** (availabilityState = VALID)

All three paths flow to `persistP3Calculation` unconditionally.

### 1.6 Why Was Snapshot 7 Available to Persistence?

The pre-P3-10E.13 resolver looked up a snapshot by **exact** `windowEnd` (2026-08-11T00:00:00Z), found none, checked coverage (exists at 2026-08-10), and fell through to **INSERT** a new snapshot with 0 members. This empty snapshot was marked `AVAILABLE` because:
- The old resolver did not validate member count > 0
- The old resolver did not validate member digest
- The old resolver treated "0 events on empty ledger" as success

The refactored resolver (P3-10E.13) now validates snapshot integrity via `readSnapshotMembers()`, which checks `memberCount !== resolvedMembers.length || memberDigest !== digest`. An empty snapshot with 0 members would pass this check (0 === 0, empty digest matches empty digest), but the resolver would return `availability: "AVAILABLE"` with 0 constituents — which the breadth calculation would then reject as INSUFFICIENT_HISTORY.

### 1.7 Why Was an Empty Snapshot Considered Persistable?

Because persistence had no awareness of availability state. The orchestrator called `persistP3Calculation` regardless of whether the result was VALID, INSUFFICIENT_HISTORY, INVALID, or MISSING.

---

## 2. Root Cause Summary

```text
Root cause: The orchestrator persistently writes P3 results
without gating on overall availability state.

persistP3Calculation()
is called unconditionally after aggregateP3Results(),
regardless of whether any mandatory P3 stage (P3-04
through P3-09) succeeded.
```

**Contributing factors:**
1. Orchestrator has no persistence gate on `availabilityState`
2. `persistP3Calculation` does not validate its input
3. Pre-P3-10E.13 resolver created invalid 0-member snapshots (now fixed)
4. No contract enforces "VALID only" persistence

---

## 3. Correct Persistence Contract

### 3.1 Proposed Invariant

```text
P3 historical intelligence may only be persisted when
the authoritative execution has completed all mandatory
P3 stages (P3-04 through P3-09) successfully.

Mandatory stages must all report availabilityState = "VALID".

Any stage reporting INSUFFICIENT_HISTORY, MISSING, INVALID,
STALE, AMBIGUOUS, or NOT_APPLICABLE must prevent persistence.
```

### 3.2 Minimal Code-Level Fix (NOT IMPLEMENTED — DESIGN ONLY)

**Location**: `src/lib/p3/orchestrator.ts`, Step 9 (lines 293-308)

**Current code:**
```typescript
const aggregateResult = aggregateP3Results(
  orchestratorContext,
  breadthResult,
  momentumResult,
  relativeStrengthResult,
  leadershipResult,
  regimeResult,
  rotationResult
);

const persistence = await persistP3Calculation({
  context: orchestratorContext,
  result: aggregateResult,
  membershipSource: "authoritative_membership_snapshot",
  membershipMode: context.calculationMode,
});
```

**Proposed fix (design only):**

```typescript
const aggregateResult = aggregateP3Results(
  orchestratorContext,
  breadthResult,
  momentumResult,
  relativeStrengthResult,
  leadershipResult,
  regimeResult,
  rotationResult
);

// PERSISTENCE GATE: only persist when ALL mandatory stages are VALID
if (aggregateResult.availabilityState !== "VALID") {
  throw new P3InsufficientDataError(
    `P3 calculation did not complete successfully: overall availability ${aggregateResult.availabilityState}` +
    ` at window_end=${context.windowEnd.toISOString()}` +
    (aggregateResult.availabilityReason ? ` (${aggregateResult.availabilityReason})` : "")
  );
}

const persistence = await persistP3Calculation({
  context: orchestratorContext,
  result: aggregateResult,
  membershipSource: "authoritative_membership_snapshot",
  membershipMode: context.calculationMode,
});
```

**Defense-in-depth** (also recommended, design only): Add guard in `persistP3Calculation` itself:

```typescript
// In persistP3Calculation(), at the top:
if (result.availabilityState !== "VALID") {
  throw new P3PersistenceError(
    `Refusing to persist P3 result with availabilityState=${result.availabilityState}`
  );
}
```

### 3.3 Why Both Gates

- **Orchestrator gate**: Prevents the orchestrator from ever reaching persistence with a failed result. This is the primary contract enforcement point.
- **Persistence gate**: Defense-in-depth. Catches any code path that calls `persistP3Calculation` directly (e.g., manual or future code).

---

## 4. Snapshot 7 Treatment Options

### Option A — Invalid-Artifact Status Field

Add a `status` column to `p3_narrative_intelligence` (default `VALID`, set `INVALID` for snapshot 7's record):

```sql
ALTER TABLE p3_narrative_intelligence
ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'VALID';

UPDATE p3_narrative_intelligence
SET status = 'INVALID'
WHERE id = 1;
```

**Pros**: Simple, inline with the record.
**Cons**: Requires UPDATE on the immutable P3 table (blocked by immutability trigger). Violates the immutability contract. Reject this option.

### Option B — Correction/Supersession Ledger

Create an append-only `p3_historical_corrections` table:

```sql
CREATE TABLE p3_historical_corrections (
  id SERIAL PRIMARY KEY,
  original_intelligence_id INTEGER NOT NULL REFERENCES p3_narrative_intelligence(id) ON DELETE RESTRICT,
  original_snapshot_id BIGINT REFERENCES narrative_membership_snapshots(id) ON DELETE RESTRICT,
  corrected_snapshot_id BIGINT REFERENCES narrative_membership_snapshots(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  algorithm_key VARCHAR(100),
  algorithm_version VARCHAR(50),
  corrected_by VARCHAR(100),
  provenance JSONB
);

INSERT INTO p3_historical_corrections
  (original_intelligence_id, original_snapshot_id, corrected_snapshot_id, reason, algorithm_key, algorithm_version, corrected_by, provenance)
VALUES
  (1, 7, 2,
   'Invalid 0-member snapshot referenced by failed P3-10E.11 execution. Superseded by authoritative baseline snapshot 2.',
   'p3-orchestrator', '1',
   'P3-10E.14',
   '{"original_availability_state": "INSUFFICIENT_HISTORY", "original_member_count": 0}');
```

**Pros**: Append-only, does not mutate existing records, preserves immutability, provides an audit trail.
**Cons**: Requires readers to JOIN corrections to know the authoritative reference.

### Option C — No Correction

Leave snapshot 7 and the p3_narrative_intelligence id=1 record as-is. The refactored resolver (P3-10E.13) never selects snapshot 7 for authoritative resolution because it anchors on coverage_start, not exact window_end. The `readSnapshotMembers` digest validation would reject snapshot 7's 0-member state if it somehow became a baseline candidate.

**Pros**: Minimal change, no schema modifications.
**Cons**: The p3_narrative_intelligence record still references an invalid snapshot. Future queries that join on `membership_snapshot_id` would retrieve an empty snapshot. Confusing for analysts.

## 5. Recommended Architecture

```text
Recommended: Option B (Correction/Supersession Ledger)

1. The p3_historical_corrections table is append-only (INSERT only).
2. Original records remain immutable and untouched.
3. Snapshot 7 remains in the database as an invalid historical artifact.
4. p3_narrative_intelligence id=1 remains referencing snapshot 7 in its
   membership_snapshot_id field.
5. A correction record links id=1 -> snapshot 2.
6. A read-layer helper (resolveEffectiveMembership(intelligence_id)) applies
   corrections transparently.
7. Future resolvers and analytics use the correction-aware lookup.
```

**How future readers distinguish authoritative from invalid:**

```text
Authoritative historical snapshot:
  - Has no correction record referencing it as "original"
  - OR is referenced as "corrected_snapshot_id" in a correction record

Invalid execution artifact:
  - Is referenced as "original_snapshot_id" in a correction record
  - OR has 0 members / failed digest validation
```

---

## 6. Resolver Verification (Part 4)

### READ-ONLY Verification Results

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Snapshots count before | 6 | 6 | PASS |
| Baseline lookup target (coverage_start=2026-08-10T09:09:44) | snapshot_id=2, 7 members | snapshot_id=2, 7 members | PASS |
| Snapshot 7 as baseline | 0 matches | 0 matches | PASS |
| Events after baseline (2026-08-10 to 2026-08-11) | 0 | 0 | PASS |
| Snapshots count after | 6 | 6 | PASS |
| Mutation check | no new snapshots | no new snapshots | PASS |

### Snapshot 7 Cannot Become Authoritative

The refactored resolver (`resolveP3Membership` in `src/lib/p3/membership.ts`):
1. Finds coverage (coverage_start = 2026-08-10T09:09:44)
2. Looks up baseline snapshot where `window_end = coverage_start` (not the requested window_end)
3. Snapshot 7 has `window_end = 2026-08-11T00:00:00Z`, which does NOT match coverage_start
4. Therefore snapshot 7 is NEVER selected as baseline
5. The resolver returns snapshot 2 (7 members) with `source = "membership_snapshot"`

**Confirmed**: Snapshot 7 cannot become authoritative merely because it has a matching `window_end`.

---

## 7. Migration Design (Part 6)

### 7.1 Migration: Create `p3_historical_corrections` Table

```sql
-- Migration: 0012_create_p3_historical_corrections

CREATE TABLE p3_historical_corrections (
  id SERIAL PRIMARY KEY,
  original_intelligence_id INTEGER NOT NULL
    REFERENCES p3_narrative_intelligence(id) ON DELETE RESTRICT,
  original_snapshot_id BIGINT
    REFERENCES narrative_membership_snapshots(id) ON DELETE RESTRICT,
  corrected_snapshot_id BIGINT
    REFERENCES narrative_membership_snapshots(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  algorithm_key VARCHAR(100),
  algorithm_version VARCHAR(50),
  corrected_by VARCHAR(100),
  provenance JSONB
);

CREATE INDEX p3_historical_corrections_original_idx
  ON p3_historical_corrections(original_intelligence_id);

CREATE INDEX p3_historical_corrections_original_snapshot_idx
  ON p3_historical_corrections(original_snapshot_id);
```

**Immutability**: The table is INSERT-only. No UPDATE/DELETE triggers are needed — the immutability is enforced by convention and application code. P0-P2 tables are untouched.

**P0-P2 compatibility**: No impact. The migration only adds a new table and references existing P3 tables via FK.

**Historical reproducibility**: Existing query results are unaffected. Only new queries that opt into correction-aware lookups will see the correction.

**Deterministic resolver behavior**: The resolver continues to operate identically. Correction is applied at the read layer only.

### 7.2 Seed Data (NOT applied in this task)

```sql
INSERT INTO p3_historical_corrections
  (original_intelligence_id, original_snapshot_id, corrected_snapshot_id, reason,
   algorithm_key, algorithm_version, corrected_by, provenance)
VALUES
  (1, 7, 2,
   'Invalid 0-member snapshot referenced by failed P3-10E.11 execution. Superseded by authoritative baseline snapshot 2.',
   'p3-orchestrator', '1', 'P3-10E.14',
   '{"original_availability_state": "INSUFFICIENT_HISTORY", "original_member_count": 0}');
```

### 7.3 Migration: Add Persistence Gate

```sql
-- No SQL migration needed — this is a code-level fix in orchestrator.ts
-- See Section 3.2 for the TypeScript diff
```

---

## 8. Test Plan (Part 7)

### 8.1 Persistence Safety

```text
Test: failed stage prevents persistence
  - Mock P3-04 through P3-09 to return INSUFFICIENT_HISTORY
  - Assert persistP3Calculation is NOT called
  - Assert P3InsufficientDataError thrown
  - Assert no DB writes occurred

Test: insufficient history prevents persistence
  - Mock stages to return MISSING
  - Assert persistP3Calculation is NOT called
  - Assert P3InsufficientDataError thrown

Test: successful complete execution persists exactly once
  - Mock all stages to return VALID
  - Assert persistP3Calculation called exactly once
  - Assert p3_narrative_intelligence record created with availability_state=VALID
```

### 8.2 Membership

```text
Test: baseline window resolves to snapshot 2
  - resolveP3Membership(1, 2026-08-10T09:09:44Z)
  - Assert snapshotId=2, members=[1,4,5,10,11,12,22], availability=AVAILABLE

Test: later window without events reuses snapshot 2
  - resolveP3Membership(1, 2026-08-11T00:00:00Z)
  - Assert snapshotId=2, members=[1,4,5,10,11,12,22], availability=AVAILABLE
  - Assert no new snapshot created

Test: later window with events applies events in-memory
  - Insert membership events
  - resolveP3Membership(1, future_windowEnd)
  - Assert computed membership from baseline + events

Test: invalid snapshot 7 never authoritative
  - resolveP3Membership(1, 2026-08-11T00:00:00Z)
  - Assert snapshotId=7 is NOT returned
  - Assert snapshotId=2 is returned
```

### 8.3 Immutability

```text
Test: historical snapshot UPDATE rejected
  - Attempt UPDATE on narrative_membership_snapshots
  - Assert "P3 historical records are immutable" error

Test: historical snapshot DELETE rejected
  - Attempt DELETE on narrative_membership_snapshots
  - Assert "P3 historical records are immutable" error
```

### 8.4 Determinism

```text
Test: repeated resolver execution is identical
  - Call resolveP3Membership twice with same inputs
  - Assert identical results
  - Assert zero DB mutations between calls

Test: correction-aware lookup is deterministic
  - resolveEffectiveMembership(1) returns snapshot 2
  - Repeated calls return identical results
```

---

## 9. P0-P2 Impact Analysis

| Area | Impact |
|------|--------|
| narratives table | No change |
| coins table | No change |
| coin_narratives table | No change |
| narrative_health table | No change |
| market_price_daily (2026-08-11) | Not addressed (separate prerequisite) |
| P0-P2 logic | No change |
| P0-P2 thresholds | No change |
| /api/refresh | No change |
| MomentumService (P0-P2 compatibility path) | No change |

---

## 10. Implementation Plan (Next Task)

### P3-10E.15 — This Task (DESIGN ONLY)

- [x] Read-only forensic audit of persistence boundary
- [x] Root cause identification
- [x] Persistence contract definition
- [x] Snapshot 7 treatment options evaluated
- [x] Resolver verification (READ-ONLY)
- [x] Migration design
- [x] Test plan design
- [x] P0-P2 impact analysis
- [ ] **DO NOT** implement code changes
- [ ] **DO NOT** apply migrations
- [ ] **DO NOT** execute orchestrator
- [ ] **DO NOT** modify production data

### P3-10E.16 — Next Task (REQUIRES APPROVAL)

Implement the following (owner approval required):

1. **Persistence gate** (orchestrator.ts, ~5 lines of TypeScript)
2. **Defense-in-depth gate** (persistence.ts, ~5 lines of TypeScript)
3. **Migration 0012**: Create `p3_historical_corrections` table
4. **Seed data**: Insert correction record linking id=1 snapshot_id=7 -> snapshot 2
5. **Read-layer helper**: `resolveEffectiveMembership(intelligence_id)` that applies corrections
6. **Tests**: All tests from Section 8
7. **Post-implementation verification**: Re-run forensic checks

### What Remains After P3-10E.16

- P3-10E.15 does NOT execute any writes
- Snapshot 7 remains immutable throughout
- p3_narrative_intelligence id=1 remains referencing snapshot 7 in its raw form
- The correction is applied read-layer transparently via the correction ledger

---

## 11. Final Status

```text
P3-10E.15 STATUS: DESIGN PASS
```

### What Was Verified (READ-ONLY)

- ✅ Persistence boundary audit complete
- ✅ Root cause identified: persistence called unconditionally regardless of availability state
- ✅ Correct persistence invariant defined (all stages VALID required)
- ✅ Snapshot 7 treatment options evaluated (Option B recommended)
- ✅ Resolver verification confirms snapshot 7 cannot become authoritative
- ✅ Migration design for `p3_historical_corrections` (not applied)
- ✅ Test plan designed (not implemented)
- ✅ P0-P2 impact: zero

### What Was NOT Done (By Design)

- ❌ No code changes implemented
- ❌ No migrations applied
- ❌ No production data modified
- ❌ Orchestrator NOT executed
- ❌ Snapshot 7 NOT modified or deleted
