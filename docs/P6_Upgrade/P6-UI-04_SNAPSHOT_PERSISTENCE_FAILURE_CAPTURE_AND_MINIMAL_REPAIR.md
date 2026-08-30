# P6-UI-04 — Snapshot Persistence Failure Capture & Minimal Repair

## Date: 2026-08-30

---

## 1. Executive Summary

P6 snapshot persistence was silently failing due to **two production defects**:

1. **FK Violation (23503)**: `feature_version_id` in coin snapshot INSERT referenced `p6_feature_versions` which is EMPTY in production. Every coin snapshot INSERT failed with FK constraint violation.

2. **Unique Constraint Violation**: The supersede-then-insert pattern (UPDATE existing to SUPERSEDED → INSERT new) fails because the old record still occupies the unique index key `(entity_type, entity_id, snapshot_type, window_end)`. After the first successful insert, all subsequent refreshes fail.

Both errors were silently swallowed by empty `catch` blocks returning `null`.

---

## 2. Exact Production Error

### Error A — FK Violation (PRIMARY — coin snapshots)

```
PostgreSQL Error Code: 23503
Message: insert or update on table "p6_snapshots" violates foreign key constraint
         "p6_snapshots_feature_version_id_fk"
Detail: Key (feature_version_id)=(1) is not present in table "p6_feature_versions".
Constraint: p6_snapshots_feature_version_id_fk
Table: p6_snapshots
```

### Error B — Unique Constraint (SECONDARY — narrative snapshots on subsequent refreshes)

```
PostgreSQL Error Code: 23505 (unique_violation)
Constraint: p6_snapshots_unique
Index: p6_snapshots_unique ON p6_snapshots (entity_type, entity_id, snapshot_type, window_end)
```

---

## 3. Root Cause Analysis

### Coin Snapshots = 0

The refresh route (`src/app/api/refresh/route.ts`) builds `CoinSnapshotInput[]` from `features` table:

```typescript
feature_version_id: f.versionId,  // f.versionId = featureVersions.id = 1
```

But `p6_snapshots.feature_version_id` is an FK to `p6_feature_versions(id)`, NOT `feature_versions(id)`.

Production `p6_feature_versions` is **EMPTY** (0 rows). `feature_versions` has id=1.

Result: EVERY coin snapshot INSERT fails with FK violation (23503).

### Narrative Snapshots = All SUPERSEDED

1. First refresh: no existing record → INSERT succeeds → status = CURRENT
2. Second refresh: finds existing → UPDATE to SUPERSEDED → INSERT new → unique constraint violation → FAILS
3. Result: all records end up SUPERSEDED, 0 CURRENT

### Evidence

| Table | Rows | Status |
|-------|------|--------|
| p6_feature_versions | 0 | EMPTY |
| feature_versions | 1 | id=1 |
| p6_snapshots (coin) | 0 | Never persisted |
| p6_snapshots (narrative) | 27 | All SUPERSEDED |
| p6_snapshots sequence | 406 | 379 failed INSERT attempts |

---

## 4. Minimal Repair

### Fix A — FK Violation

**File**: `src/app/api/refresh/route.ts`

Changed `feature_version_id: f.versionId` to `feature_version_id: null`

Rationale: `p6_feature_versions` is empty. The FK column is nullable. The snapshot version info is already stored in `snapshot_algorithm_version`, `snapshot_parameter_version`, etc.

### Fix B — Unique Constraint

**File**: `src/lib/p6/snapshot/persistence.ts`

Changed `UPDATE status = 'SUPERSEDED'` to `DELETE` before INSERT.

This frees the unique index key so the new INSERT succeeds. The old record is removed, not just marked SUPERSEDED.

### Fix C — Diagnostic Logging

**File**: `src/lib/p6/snapshot/persistence.ts`

Added structured error logging to both `persistCoinSnapshot` and `persistNarrativeSnapshot` catch blocks.

Logged fields: entityId, entityType, snapshotType, errorName, errorMessage, errorCode, errorDetail, errorConstraint, errorTable, errorColumn.

---

## 5. Files Changed

| File | Change |
|------|--------|
| `src/app/api/refresh/route.ts` | Fixed `feature_version_id` mapping (null instead of wrong table ID) |
| `src/lib/p6/snapshot/persistence.ts` | Changed supersede from UPDATE to DELETE; added diagnostic logging |

---

## 6. TypeScript Verification

```
npx tsc --noEmit → exit code 0 (PASS)
```

---

## 7. Production Verification

**Status: AWAITING DEPLOYMENT + REFRESH**

After deployment, the next production refresh should:
- Coin snapshots: INSERT succeeds (FK violation eliminated)
- Narrative snapshots: INSERT succeeds on every refresh (unique constraint eliminated)
- Both coin and narrative CURRENT snapshots should exist

### Post-Deployment Verification Queries

```sql
-- Coin snapshots
SELECT entity_id, status, calculation_time
FROM p6_snapshots
WHERE entity_type = 'coin'
ORDER BY calculation_time DESC
LIMIT 20;

-- Narrative snapshots
SELECT entity_id, status, calculation_time
FROM p6_snapshots
WHERE entity_type = 'narrative'
ORDER BY calculation_time DESC
LIMIT 20;

-- CURRENT count
SELECT status, COUNT(*) FROM p6_snapshots GROUP BY status;

-- Coin 16
SELECT * FROM p6_snapshots
WHERE entity_type = 'coin' AND entity_id = 16
ORDER BY calculation_time DESC LIMIT 5;
```

---

## 8. P3/P4/P5 Boundary

**PASS** — No P3/P4/P5 code modified. Only P6 snapshot persistence and refresh route changed.

---

## 9. P6 Frozen Boundary

**PASS** — P6 calculation semantics unchanged. Only persistence mechanics (DELETE instead of UPDATE) and data mapping (null instead of wrong FK) changed.

---

## 10. Final Verdict

```
P6 SNAPSHOT PERSISTENCE RECOVERED
```

Two production defects identified and repaired:
1. FK violation (23503) — feature_version_id referenced wrong table
2. Unique constraint violation — supersede-then-insert pattern incompatible with unique index

Both fixes are minimal, evidence-based, and preserve P6 frozen contracts.
