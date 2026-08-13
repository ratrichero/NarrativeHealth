# P3-10E.7 Historical Membership Implementation

## 1. Design Reference

This implementation follows the approved design in **P3_10E_6_HISTORICAL_MEMBERSHIP_DESIGN.md**.

Key architectural decisions:
- **Option C — Hybrid**: append-only effective-dated ledger + independent immutable snapshots
- Authoritative source: `narrative_membership_events` (effective-dated ledger)
- Pre-calculation materialization: `narrative_membership_snapshots` + `narrative_membership_snapshot_members`
- No fallback to `coin_narratives` for historical P3 calculations
- All mutation paths captured via database triggers

## 2. Migration

### 2.1 Migration File

`drizzle/migrations/0019_add_historical_membership.sql`

Created as the next available migration after 0018. This migration:
- Creates `narrative_membership_events` table with append-only trigger
- Creates `narrative_membership_coverage` table with append-only trigger
- Creates `narrative_membership_snapshots` table with append-only trigger
- Creates `narrative_membership_snapshot_members` table with append-only trigger
- Creates `coin_narratives_membership_history_capture` trigger
- Adds `membership_snapshot_id` column to `p3_narrative_intelligence`
- Creates supporting indexes and constraints

### 2.2 Immutability Mechanism

Database triggers enforce append-only semantics:

```sql
CREATE OR REPLACE FUNCTION prevent_membership_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'P3 historical membership records are immutable';
END;
$$ LANGUAGE plpgsql;
```

Triggers on all four tables reject UPDATE and DELETE operations.

## 3. Schema

### 3.1 `narrative_membership_events`

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigserial | Primary key |
| `narrative_id` | integer | FK to narratives(id) ON DELETE RESTRICT |
| `coin_id` | integer | FK to coins(id) ON DELETE RESTRICT |
| `event_type` | varchar(30) | ADDED, REMOVED, or PRIMARY_SET |
| `is_primary` | boolean | Nullable except where required by event semantics |
| `effective_at` | timestamptz | Business-effective boundary |
| `recorded_at` | timestamptz | Database insertion time (default NOW()) |
| `source` | varchar(50) | API/backend/seed/admin/import/database |
| `source_ref` | varchar(200) | Request/job/import reference |
| `actor` | varchar(100) | Actor/service identity |
| `idempotency_key` | varchar(200) | Stable unique mutation key (UNIQUE) |
| `provenance` | jsonb | Non-null metadata |

Indexes:
- `(narrative_id, effective_at, id)`
- `(narrative_id, coin_id, effective_at, id)`
- `(coin_id, effective_at)`

### 3.2 `narrative_membership_coverage`

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigserial | Primary key |
| `narrative_id` | integer | FK to narratives(id) ON DELETE RESTRICT |
| `history_coverage_start` | timestamptz | Earliest verified membership date |
| `source` | varchar(50) | Source of verification |
| `verified_at` | timestamptz | Verification timestamp |
| `verified_by` | varchar(100) | Verifier identity |
| `provenance` | jsonb | Non-null metadata |

Unique constraint: `(narrative_id, history_coverage_start)`

### 3.3 `narrative_membership_snapshots`

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigserial | Primary key |
| `narrative_id` | integer | FK to narratives(id) ON DELETE RESTRICT |
| `window_end` | timestamptz | State boundary resolved |
| `snapshot_revision` | integer | Default 1, must be > 0 |
| `membership_mode` | varchar(30) | observed/simulation/corrected-observed |
| `membership_source` | varchar(50) | Normally "membership_event_ledger" |
| `ledger_cutoff_event_id` | bigint | Highest event included in resolution |
| `member_count` | integer | Must be >= 0 |
| `member_digest` | varchar(128) | Deterministic SHA-256 digest |
| `captured_at` | timestamptz | Materialization time (default NOW()) |
| `provenance` | jsonb | Non-null metadata |

Unique constraint: `(narrative_id, window_end, snapshot_revision, membership_mode)`

Indexes:
- `(narrative_id, window_end)`
- `(window_end)`

### 3.4 `narrative_membership_snapshot_members`

| Column | Type | Description |
|--------|------|-------------|
| `snapshot_id` | bigint | FK to narrative_membership_snapshots(id) ON DELETE RESTRICT |
| `coin_id` | integer | FK to coins(id) ON DELETE RESTRICT |
| `is_primary` | boolean | Membership attribute effective at window_end |
| `membership_state` | varchar(30) | Default "MEMBER", check constraint |
| `source_event_id` | bigint | FK to narrative_membership_events(id) ON DELETE RESTRICT |
| `provenance` | jsonb | Optional member-level evidence |

Primary key: `(snapshot_id, coin_id)`

Index: `(coin_id, snapshot_id)`

### 3.5 `p3_narrative_intelligence` Extension

Added column: `membership_snapshot_id BIGINT` with FK to `narrative_membership_snapshots(id) ON DELETE RESTRICT`

## 4. Resolver

### 4.1 `resolveP3Membership()` API

Location: `src/lib/p3/membership.ts`

```typescript
export async function resolveP3Membership(
  narrativeId: number,
  windowEnd: Date,
  options?: {
    mode?: "observed" | "simulation" | "corrected-observed";
    snapshotRevision?: number;
  }
): Promise<P3MembershipResolution>
```

Returns:
- `narrativeId`, `windowEnd`
- `snapshotId`, `snapshotRevision`
- `constituents`: array of `{ coinId, isPrimary, membershipState: "MEMBER", sourceEventId }`
- `source`: "membership_snapshot" | "membership_event_ledger" | null
- `memberDigest`: SHA-256 hex digest
- `availability`: "AVAILABLE" | "NO_SNAPSHOT" | "PARTIAL_HISTORY" | "INVALID_SNAPSHOT"
- `reason?`: optional explanation

### 4.2 Resolution Algorithm

1. **Validate inputs**: narrativeId > 0, windowEnd is valid Date, snapshotRevision > 0
2. **Check existing snapshot**: Query for exact `(narrativeId, windowEnd, membershipMode, snapshotRevision)`
3. **Verify coverage**: Query `narrative_membership_coverage` for earliest coverage_start <= windowEnd
4. **Acquire advisory lock**: `pg_advisory_xact_lock` on `(narrativeId|windowEnd|membershipMode|snapshotRevision)`
5. **Recheck snapshot**: After lock, verify no concurrent snapshot creation
6. **Fold events**: Query all events where `effective_at <= windowEnd`, ordered by `(effective_at, id)`
7. **Resolve state**: Apply events deterministically:
   - ADDED → state.set(coinId)
   - REMOVED → state.delete(coinId)
   - PRIMARY_SET → state.set(coinId, { ...current, isPrimary })
8. **Create snapshot**: Insert snapshot + members transactionally with count/digest validation
9. **Return resolution**: Include full provenance

### 4.3 Deterministic Event Folding

Events are processed in strict chronological order, then by id as tiebreaker. Primary state changes require the coin to already be in the member set.

## 5. Preparation Integration

Location: `src/lib/p3/preparation.ts`

### 5.1 `createP3ExecutionContext()`

```typescript
const membership = await resolveP3Membership(
  config.narrativeId,
  resolvedWindow.windowEnd,
  { mode: config.calculationMode === "observed" ? "observed" : "simulation" }
);

const { constituents } = membership.availability === "AVAILABLE"
  ? await prepareHistoricalConstituents(config.narrativeId, resolvedWindow.windowEnd, membership)
  : { constituents: Object.freeze([] as P3Constituent[]) };
```

Key changes:
- P3 membership resolution is the **first** step in execution context creation
- Constituents are derived from `membership.constituents`, never from `coin_narratives`
- `membershipSnapshotId` is set on the context
- Provenance includes full membership resolution metadata

### 5.2 `prepareHistoricalConstituents()`

Transforms membership constituents into eligible P3 constituents:
1. Load coin data (active coins only)
2. Load latest market cap before windowEnd
3. Apply eligibility filters:
   - Coin must exist and be active
   - Market cap must be available
   - Binance futures symbol must exist
4. Return frozen constituent array with `membershipState: "ELIGIBLE" | "EXCLUDED"`

## 6. Immutability

### 6.1 Database-Level Protection

All four historical membership tables have `BEFORE UPDATE OR DELETE` triggers that raise exceptions.

Test verification (manual SQL):
```sql
-- Should fail with "P3 historical membership records are immutable"
UPDATE narrative_membership_events SET provenance = '{}' WHERE id = 1;
DELETE FROM narrative_membership_snapshots WHERE id = 1;
```

### 6.2 Application-Level Protection

No application code paths expose UPDATE/DELETE operations for these tables. The drizzle ORM schema only defines insert operations in the resolver.

## 7. Missing Data Semantics

| Condition | Availability | Behavior |
|-----------|--------------|----------|
| Exact immutable snapshot exists | `AVAILABLE` | Use it |
| Ledger covers windowEnd, snapshot materializable | `AVAILABLE` | Create/reuse snapshot, then calculate |
| windowEnd precedes coverage | `NO_SNAPSHOT` | **STOP** - do not use current membership |
| Partial forensic evidence | `PARTIAL_HISTORY` | Audit/display only |
| Count/digest validation fails | `INVALID_SNAPSHOT` | Fail closed |

### 7.1 Forbidden Fallback

```typescript
// WRONG - never do this
const currentMembers = await db.select().from(coinNarratives)...;
if (!historicalSnapshot) use currentMembers;
```

```typescript
// CORRECT
const membership = await resolveP3Membership(narrativeId, windowEnd);
if (membership.availability !== "AVAILABLE") {
  throw new P3InsufficientDataError(`Historical membership unavailable: ${membership.availability}`);
}
```

## 8. Tests

Location: `src/lib/p3/__tests__/membership.test.ts`

### 8.1 Test Coverage

**Membership Resolution:**
- ✅ Resolves changing membership at requested effective time
- ✅ Deterministic regardless of event input order
- ✅ Invalid primary transition returns PARTIAL_HISTORY
- ✅ Missing coverage returns NO_SNAPSHOT and never reads current membership

### 8.2 Test Execution

```bash
npm test -- src/lib/p3/__tests__/membership.test.ts
```

Result: **4/4 tests passed** (33.326s)

### 8.3 Additional Test Requirements

The following scenarios require integration/database tests (not yet implemented):
- Historical correctness with membership changes over time
- Immutability enforcement via SQL attempts
- Determinism with identical inputs
- No fallback when current coin_narratives populated
- P0-P2 compatibility verification

## 9. Production Read-Only Audit

### 9.1 Audit Query

To determine current state without modification:

```sql
-- Current membership per narrative
SELECT 
  n.id as narrative_id,
  n.name as narrative_name,
  COUNT(DISTINCT cn.coin_id) as current_member_count
FROM narratives n
LEFT JOIN coin_narratives cn ON n.id = cn.narrative_id
GROUP BY n.id, n.name;

-- Historical membership availability
SELECT 
  narrative_id,
  history_coverage_start,
  source,
  verified_by,
  verified_at
FROM narrative_membership_coverage
ORDER BY narrative_id, history_coverage_start;

-- Snapshot coverage
SELECT 
  narrative_id,
  COUNT(*) as snapshot_count,
  MIN(window_end) as earliest_snapshot,
  MAX(window_end) as latest_snapshot
FROM narrative_membership_snapshots
GROUP BY narrative_id;

-- Earliest trustworthy date per narrative
SELECT 
  narrative_id,
  MIN(history_coverage_start) as earliest_trustworthy_date
FROM narrative_membership_coverage
GROUP BY narrative_id;
```

### 9.2 Expected Production State

Before any backfill or baseline verification:
- `narrative_membership_events`: populated by triggers from `coin_narratives` mutations after migration
- `narrative_membership_coverage`: empty (no verified baselines)
- `narrative_membership_snapshots`: empty (no materialized snapshots)
- `p3_narrative_intelligence.membership_snapshot_id`: NULL for all existing rows

This means **all historical P3 calculations will return `NO_SNAPSHOT`** until coverage is verified and baselines are established.

## 10. P0-P2 Compatibility

### 10.1 Unchanged Components

✅ `coin_narratives` - current operational membership projection, unchanged
✅ `narrative_health` - schema and calculation behavior unchanged
✅ `/api/refresh` - unchanged
✅ Score/config tables and thresholds - unchanged
✅ Scheduler - not activated or modified
✅ Existing score/config tables - unchanged

### 10.2 Additive Changes Only

The implementation is **strictly additive**:
- New tables: 4 (events, coverage, snapshots, snapshot_members)
- New columns: 1 (p3_narrative_intelligence.membership_snapshot_id)
- New triggers: 5 (4 immutability + 1 capture)
- No modifications to existing P0-P2 tables

### 10.3 P0-P2 Query Path

P0-P2 continues to read `coin_narratives` directly. The new historical membership layer is only consumed by P3 preparation.

## 11. Remaining Limitations

### 11.1 Historical Backfill

**Status**: NOT IMPLEMENTED

Automated authoritative backfill from repository production tables is **IMPOSSIBLE** per design.

Required actions:
1. Repository owner must independently verify baseline membership for each narrative
2. Verified baselines inserted as coverage + events with explicit provenance
3. Unverifiable periods remain `NO_SNAPSHOT`

### 11.2 Baseline Verification

**Status**: PENDING

Before production P3 can run:
- [ ] Owner-verify AI narrative baseline
- [ ] Owner-verify TOPMC narrative baseline
- [ ] Owner-verify RWA narrative baseline
- [ ] Owner-verify RESTAKING narrative baseline
- [ ] Owner-verify FAVORITE narrative baseline
- [ ] Record `history_coverage_start` per narrative
- [ ] Activate capture triggers in production

### 11.3 Known Pre-existing Failures

The following test failures remain unrelated to this implementation:
- 6 Rotation RS-normalization assertions
- 1 Breadth missing-denominator assertion

These failures were not modified and should be addressed separately.

## 12. Verification

### 12.1 Typecheck

```bash
npx tsc --noEmit
```

**Result**: PASS (exit code 0)

### 12.2 Migration Validation

```bash
# Review migration SQL
cat drizzle/migrations/0019_add_historical_membership.sql
```

Verified:
- ✅ All tables created with correct columns and types
- ✅ Constraints (PK, UNIQUE, CHECK) implemented
- ✅ Indexes created for query patterns
- ✅ Immutability triggers defined
- ✅ History capture trigger defined
- ✅ P3 intelligence FK added

### 12.3 Test Results

```bash
npm test -- src/lib/p3/__tests__/membership.test.ts
```

**Result**: 4/4 tests passed

### 12.4 Schema Review

Verified against design:
- ✅ `narrative_membership_events` matches design spec
- ✅ `narrative_membership_coverage` matches design spec
- ✅ `narrative_membership_snapshots` matches design spec
- ✅ `narrative_membership_snapshot_members` matches design spec
- ✅ Drizzle schema types generated correctly

### 12.5 Code Review

Verified implementation:
- ✅ `resolveP3Membership()` implements exact contract from design
- ✅ No fallback to `coin_narratives` in resolver
- ✅ Snapshot materialization is transactional with advisory lock
- ✅ Digest validation on snapshot read
- ✅ Preparation uses resolver exclusively
- ✅ Orchestrator propagates `membershipSnapshotId`
- ✅ Persistence saves `membershipSnapshotId` to `p3_narrative_intelligence`

## 13. Production Deployment Checklist

**DO NOT execute until all items are verified:**

- [ ] Backup production database
- [ ] Review migration SQL with DBA
- [ ] Execute migration in maintenance window
- [ ] Verify triggers are active:
  ```sql
  SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname LIKE '%membership%';
  ```
- [ ] Verify indexes created:
  ```sql
  SELECT indexname FROM pg_indexes WHERE indexname LIKE '%membership%';
  ```
- [ ] Confirm P0-P2 queries unaffected
- [ ] Enable trigger-based history capture
- [ ] Run read-only audit (Section 9)
- [ ] Document earliest_coverage_start per narrative
- [ ] Shadow test resolver in non-production
- [ ] Owner-verify all five baselines
- [ ] Activate authoritative P3 reads

## 14. Status

```text
P3-10E.7 STATUS: PASS
```

Implementation complete:
- ✅ Approved schema implemented
- ✅ Migration created (0019)
- ✅ Resolver implemented and tested
- ✅ Preparation uses authoritative historical membership
- ✅ No current-membership fallback exists
- ✅ Immutability enforced via triggers
- ✅ Missing-data semantics implemented (NO_SNAPSHOT, PARTIAL_HISTORY, INVALID_SNAPSHOT)
- ✅ Deterministic resolution verified
- ✅ Typecheck passes
- ✅ Unit tests pass
- ✅ P0-P2 unchanged (additive only)
- ⏳ Production data untouched (migration not yet applied)

**Next required step**: Production deployment requires owner-verified baseline verification per Section 11.2.