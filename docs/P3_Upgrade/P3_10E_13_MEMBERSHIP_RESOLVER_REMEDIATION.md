# P3-10E.13 Historical Membership Resolver Contract Remediation

## Status

```text
P3-10E.13 STATUS: PASS
```

## 1. Resolver Audit

```text
Resolver audit:
    PASS
```

### 1.1 Original Defect

The original `resolveP3Membership` implementation in `src/lib/p3/membership.ts` had a critical contract violation:

**Control flow (original):**
1. Look up snapshot by **exact** `windowEnd` → no result for window_end=2026-08-11
2. Check coverage (exists at 2026-08-10) → passes
3. Load membership events → **0 events exist**
4. **INSERT new snapshot** with 0 members (snapshot_id=7)
5. Return the empty snapshot as authoritative

**Violations:**
- Resolver performed `INSERT` during a read/resolution operation
- Empty event ledger produced an empty (0-member) snapshot
- Baseline snapshot (id=2) was never reused for later windows
- Current `coin_narratives` was never consulted (correct), but the resolver also failed to use the baseline

### 1.2 Schema Inspection

From `src/db/schema.ts`:
- `narrative_membership_snapshots`: unique on `(narrativeId, windowEnd, snapshotRevision, membershipMode)`
- `narrative_membership_snapshot_members`: PK on `(snapshotId, coinId)`
- `narrative_membership_events`: ordered by `(effectiveAt, id)` via index
- `narrative_membership_coverage`: unique on `(narrativeId, historyCoverageStart)`
- Immutability triggers prevent UPDATE/DELETE on all membership tables

## 2. Resolver Persistence Violation

```text
Resolver persistence violation:
    CONFIRMED
```

The original resolver performed:
```sql
INSERT INTO narrative_membership_snapshots
INSERT INTO narrative_membership_snapshot_members
```
during normal resolution. This is now **removed**.

## 3. Remediation Implementation

### 3.1 Mutation-Free Contract

The refactored `resolveP3Membership` is now a **pure READ/RESOLUTION boundary**:

- **NEVER** inserts into `narrative_membership_snapshots`
- **NEVER** inserts into `narrative_membership_snapshot_members`
- Safe to call repeatedly with identical results

### 3.2 Resolution Semantics

| Case | Condition | Result |
|------|-----------|--------|
| A | requested window == baseline window | Return baseline snapshot |
| B | requested window > baseline, no events | Reuse baseline snapshot |
| C | requested window > baseline, events exist | Apply events to baseline in-memory |
| D | requested window < baseline | `NO_SNAPSHOT` |
| E | coverage exists but no baseline snapshot | `PARTIAL_HISTORY` |

### 3.3 Baseline Reuse

```text
Baseline reuse:
    PASS
```

For:
```text
baseline snapshot = 2
baseline window_end = 2026-08-10
requested window_end = 2026-08-11
events after baseline = 0
```

The resolver now returns:
```text
AVAILABLE
snapshotId = 2
members = [1, 4, 5, 10, 11, 12, 22]
```

No new snapshot is created.

### 3.4 Event Application

```text
Event application:
    PASS
```

Events are applied chronologically:
1. Sort by `effectiveAt` then `id` (deterministic)
2. Apply `ADDED` / `REMOVED` / `PRIMARY_SET` to baseline membership
3. Return computed state with `source = "membership_event_ledger"`

### 3.5 No Current-Membership Fallback

```text
No-current-membership-fallback:
    PASS
```

The resolver never reads `coin_narratives`. Historical resolution follows baseline + events only.

## 4. Resolver is Mutation-Free

```text
Resolver is mutation-free:
    PASS
```

Verified by:
- Code inspection: no `insert` calls remain in `resolveP3Membership`
- Test execution: 13/13 tests passed
- Post-test forensics: no new snapshots created (still only snapshots 2 and 7)

## 5. Snapshot 7 Forensic Status

```text
Snapshot 7 forensic status:
    REFERENCED / NEEDS REMEDIATION
```

### 5.1 Snapshot 7 Details

| Attribute | Value |
|-----------|-------|
| id | 7 |
| narrative_id | 1 |
| window_end | 2026-08-11T00:00:00Z |
| snapshot_revision | 1 |
| membership_mode | observed |
| membership_source | membership_event_ledger |
| ledger_cutoff_event_id | NULL |
| member_count | **0** |
| member_digest | `4f53cda18c2baa0c...` (empty digest) |
| captured_at | 2026-08-10T16:50:41Z |
| provenance | `{resolver: resolveP3Membership, eventCount: 0, coverageStart: 2026-08-10T09:09:44.017Z}` |

### 5.2 References

**Snapshot 7 is REFERENCED by:**

| Table | Record |
|-------|--------|
| `p3_narrative_intelligence` | id=1, narrative=1, window_end=2026-08-11, membership_snapshot_id=7 |

### 5.3 Classification

Snapshot 7 is **NOT orphaned** — it is referenced by `p3_narrative_intelligence` id=1 (created during P3-10E.11).

**Remediation required** (NOT performed in this task):
- The `p3_narrative_intelligence` record (id=1) references an invalid 0-member snapshot
- Both records were created during the P3-10E.11 execution
- Because snapshot tables are immutable, remediation requires an explicit approved data-remediation procedure
- Recommended: delete `p3_narrative_intelligence` id=1 and its dependent records, then delete snapshot 7 (requires disabling immutability triggers under explicit approval)

## 6. Production Mutation

```text
Production mutation:
    NONE
```

No INSERT, UPDATE, DELETE, ALTER, or DROP was performed during this task. All verification was READ-ONLY.

## 7. Tests

```text
Tests:
    13/13 PASS
```

### 7.1 Pure Function Tests (7/7)

| Test | Result |
|------|--------|
| Applies ADDED events chronologically | PASS |
| Applies REMOVED events | PASS |
| Applies PRIMARY_SET events | PASS |
| Filters events after windowEnd | PASS |
| Sorts events deterministically by effectiveAt then id | PASS |
| Returns PARTIAL_HISTORY for unknown event type | PASS |
| Returns PARTIAL_HISTORY for invalid PRIMARY_SET | PASS |

### 7.2 Database-Backed Tests (6/6)

| Test | Result |
|------|--------|
| Case A: baseline exact window returns baseline snapshot | PASS |
| Case B: later window with zero events reuses baseline snapshot | PASS |
| Case C: later window with events applies events | PASS |
| Case D: before baseline returns NO_SNAPSHOT | PASS |
| Repeated resolution is mutation-free | PASS |
| No current-membership fallback | PASS |

## 8. Market Data

```text
Market data:
    PENDING 2026-08-11 market_price_daily
```

The missing `market_price_daily` data for 2026-08-11 is a separate data pipeline issue. It was NOT modified in this task.

## 9. Files Changed

| File | Change |
|------|--------|
| `src/lib/p3/membership.ts` | Refactored resolver to be mutation-free, implement baseline reuse |
| `src/lib/p3/__tests__/membership-remediation.test.ts` | Added 13 focused tests |
| `jest.config.js` | Added `setupFiles` for .env loading |
| `jest.setup.js` | New file: loads .env for tests |
| `backend/execute_p3_authoritative.ts` | Fixed persistence output type (P3-10E.11 helper) |

## 10. Final Recommendation

```text
Final recommendation:
    READY FOR P3-10E.14
```

### 10.1 Prerequisites for P3-10E.14

1. ✅ Resolver is mutation-free
2. ✅ Baseline snapshot reused when no events exist
3. ✅ No empty snapshot generated
4. ✅ Historical membership remains authoritative
5. ✅ Current coin_narratives never used as fallback
6. ✅ Event application is deterministic
7. ✅ Repeated resolution is mutation-free
8. ✅ 13/13 focused tests pass
9. ⚠️ Snapshot 7 needs remediation (referenced by p3_narrative_intelligence id=1)
10. ⚠️ 2026-08-11 market_price_daily data pending

### 10.2 Before P3-10E.14 Execution

- [ ] Owner approves snapshot 7 / p3_narrative_intelligence id=1 remediation
- [ ] 2026-08-11 market_price_daily data collected
- [ ] Re-verify pre-flight conditions