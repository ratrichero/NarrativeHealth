# P3-10E.14 Snapshot 7 Forensic Audit & Controlled Data Remediation

## Status

```text
P3-10E.14 STATUS: BLOCKED
```

## 1. Forensic Findings

### A. Snapshot 7 Details

| Attribute | Value |
|-----------|-------|
| snapshot_id | 7 |
| narrative_id | 1 |
| window_end | 2026-08-11T00:00:00Z |
| snapshot_revision | 1 |
| membership_mode | observed |
| membership_source | membership_event_ledger |
| ledger_cutoff_event_id | NULL |
| member_count | **0** |
| member_digest | `4f53cda18c2baa0c...` (empty digest) |
| captured_at | 2026-08-10T16:50:41.865395Z |
| provenance | `{resolver: resolveP3Membership, eventCount: 0, coverageStart: 2026-08-10T09:09:44.017Z}` |

**Member IDs**: NONE (0 members)

### B. P3 Intelligence Record (id=1)

| Attribute | Value |
|-----------|-------|
| id | 1 |
| narrative_id | 1 |
| window_end | 2026-08-11T00:00:00 |
| period_start | 2026-08-03T00:00:00 |
| period_end | 2026-08-11T00:00:00 |
| algorithm_key | p3-orchestrator |
| algorithm_version | 1 |
| rule_version_id | 1 |
| feature_version_id | 1 |
| score_config_id | NULL |
| **membership_snapshot_id** | **7** (INVALID) |
| calculation_mode | observed |
| availability_state | INSUFFICIENT_HISTORY |
| confidence | NULL |
| calculated_at | 2026-08-10T16:50:42.275Z |
| persisted_at | 2026-08-10T16:50:43.201964Z |

**Provenance confirms**: This is the failed P3-10E.11 execution. All module provenance references `snapshotId: 7` with `memberDigest: 4f53cda18c2baa0c...` (empty digest).

### C. Baseline Snapshot 2 Verification

| Attribute | Value |
|-----------|-------|
| snapshot_id | 2 |
| narrative_id | 1 |
| window_end | 2026-08-10T09:09:44.017522Z |
| snapshot_revision | 1 |
| membership_mode | observed |
| membership_source | membership_event_ledger |
| ledger_cutoff_event_id | NULL |
| member_count | **7** |
| member_digest | `e5177e068a96b4c3...` |
| captured_at | 2026-08-10T09:09:44.017522Z |
| provenance | `{baseline: True, resolver: resolveP3Membership, event_count: 0, coverage_start: 2026-08-10T16:09:44.017522}` |

**Member IDs**: [1, 4, 5, 10, 11, 12, 22] (all is_primary=True)

**Coverage relationship**: coverage_id=3, start=2026-08-10T09:09:44.017522Z, source=owner_verified_baseline, verified_by=production_activation

### D. All References to Snapshot 7

| Table | Reference | Count |
|-------|-----------|-------|
| p3_narrative_intelligence | id=1, membership_snapshot_id=7 | 1 |
| p3_constituent_snapshots | id=1, intelligence_id=1, member_count=0 | 1 |
| p3_constituent_snapshot_members | (for constituent snapshot id=1) | 0 |
| p3_leadership_members | (for intelligence id=1) | 0 |

**FK constraint**: `p3_narrative_intelligence_membership_snapshot_fk: FOREIGN KEY (membership_snapshot_id) REFERENCES narrative_membership_snapshots(id) ON DELETE RESTRICT`

### E. Context Verification

| Check | Result |
|-------|--------|
| Membership events | 0 (no mutations) |
| coin_narratives (narrative 1) | 7 members [1,4,5,10,11,12,22] (unchanged) |
| Snapshot 2 is owner-verified baseline | ✅ CONFIRMED |
| Snapshot 7 has zero members | ✅ CONFIRMED |
| No legitimate P3 calculation should depend on snapshot 7 | ✅ CONFIRMED (availability=INSUFFICIENT_HISTORY, all modules failed) |

## 2. Affected Records

| Table | Record ID | Current State | Required State |
|-------|-----------|---------------|----------------|
| p3_narrative_intelligence | 1 | membership_snapshot_id=7 | membership_snapshot_id=**2** |
| p3_constituent_snapshots | 1 | member_count=0 | member_count=**7** |
| p3_constituent_snapshot_members | (none) | 0 rows | **7 rows** (coins 1,4,5,10,11,12,22) |
| narrative_membership_snapshots | 7 | 0 members (invalid) | **LEAVE IMMUTABLE** |

## 3. Proposed Remediation

### 3.1 Update p3_narrative_intelligence id=1

```sql
UPDATE p3_narrative_intelligence
SET membership_snapshot_id = 2
WHERE id = 1;
```

### 3.2 Update p3_constituent_snapshots id=1

```sql
UPDATE p3_constituent_snapshots
SET member_count = 7,
    provenance = jsonb_set(
        provenance,
        '{constituents}',
        '7'
    )
WHERE id = 1;
```

### 3.3 Insert p3_constituent_snapshot_members

```sql
INSERT INTO p3_constituent_snapshot_members
(snapshot_id, coin_id, membership_state, inclusion_reason, availability_state, input_manifest)
VALUES
(1, 1, 'MEMBER', 'authoritative_baseline', 'VALID', '{"source": "baseline_snapshot_2"}'),
(1, 4, 'MEMBER', 'authoritative_baseline', 'VALID', '{"source": "baseline_snapshot_2"}'),
(1, 5, 'MEMBER', 'authoritative_baseline', 'VALID', '{"source": "baseline_snapshot_2"}'),
(1, 10, 'MEMBER', 'authoritative_baseline', 'VALID', '{"source": "baseline_snapshot_2"}'),
(1, 11, 'MEMBER', 'authoritative_baseline', 'VALID', '{"source": "baseline_snapshot_2"}'),
(1, 12, 'MEMBER', 'authoritative_baseline', 'VALID', '{"source": "baseline_snapshot_2"}'),
(1, 22, 'MEMBER', 'authoritative_baseline', 'VALID', '{"source": "baseline_snapshot_2"}');
```

### 3.4 Snapshot 7 Disposition

**LEAVE IMMUTABLE** — do NOT delete or modify.

Because:
- Membership snapshot tables are immutable (triggers prevent UPDATE/DELETE)
- No safe archival mechanism exists in the schema
- The resolver (fixed in P3-10E.13) will never select snapshot 7 for authoritative resolution
- Document as an invalid historical artifact

### 3.5 No Other Changes

- No changes to `coin_narratives`
- No changes to `narrative_membership_events`
- No changes to P0-P2 tables
- No new snapshots created
- No immutability triggers disabled

## 4. Approval Checkpoint

**STOP — AWAITING EXPLICIT OWNER APPROVAL**

The following production writes are proposed:

1. `UPDATE p3_narrative_intelligence SET membership_snapshot_id = 2 WHERE id = 1`
2. `UPDATE p3_constituent_snapshots SET member_count = 7 WHERE id = 1`
3. `INSERT INTO p3_constituent_snapshot_members` (7 rows)

Snapshot 7 remains immutable.

**Do you approve these changes?**

## 5. Post-Remediation Verification (After Approval)

1. Verify snapshot 2 remains unchanged (7 members, digest `e5177e...`)
2. Verify snapshot 7 remains immutable (0 members, unchanged)
3. Verify `p3_narrative_intelligence.id=1` now references snapshot 2
4. Verify `p3_constituent_snapshots.id=1` has member_count=7
5. Verify `p3_constituent_snapshot_members` has 7 rows for snapshot_id=1
6. Verify no P0-P2 tables changed
7. Verify no `coin_narratives` changes
8. Verify no new membership snapshot was created
9. Run resolver in READ-ONLY mode for baseline window and 2026-08-11 window
10. Confirm both resolve to snapshot 2 with 7 members
11. Confirm resolver execution causes zero database mutations

## 6. Market Data Boundary

`market_price_daily` for 2026-08-11 remains a separate prerequisite and is NOT touched in this task.

## 7. Remediation Execution Attempt

**Status**: BLOCKED BY IMMUTABILITY CONTRACT

The owner approved the remediation writes. However, execution was **blocked by the database's own immutability protection**:

```text
asyncpg.exceptions.RaiseError: P3 historical records are immutable
```

The `p3_narrative_intelligence` table has a trigger that prevents UPDATE operations. The transaction rolled back completely — **no partial changes were made**.

### Verified Post-Attempt State

| Table | Record | State | Status |
|-------|--------|-------|--------|
| p3_narrative_intelligence | id=1 | membership_snapshot_id=7 (unchanged) | ✅ UNCHANGED |
| p3_constituent_snapshots | id=1 | member_count=0 (unchanged) | ✅ UNCHANGED |
| p3_constituent_snapshot_members | (none) | 0 rows (unchanged) | ✅ UNCHANGED |
| narratives | - | 5 | ✅ PASS |
| coins | - | 25 | ✅ PASS |
| coin_narratives | - | 25 | ✅ PASS |
| narrative_health | - | 46 (pre-existing pipeline data) | ⚠️ NOT from remediation |

### Why Blocked

The P3 tables are protected by immutability triggers:
- `p3_narrative_intelligence` — UPDATE blocked
- `p3_constituent_snapshots` — UPDATE blocked
- `p3_constituent_snapshot_members` — INSERT allowed (no trigger on this table)

The proposed remediation required UPDATE operations on immutable tables, which the database correctly rejected.

### Required Path Forward

The remediation cannot be executed via direct SQL UPDATE because the P3 tables are immutable. The correct path requires:

1. **A schema-level remediation mechanism** that the owner explicitly approves
2. This may require a migration that:
   - Creates a new corrected `p3_narrative_intelligence` record (with membership_snapshot_id=2)
   - Creates a new corrected `p3_constituent_snapshots` record (with member_count=7)
   - Creates the 7 `p3_constituent_snapshot_members` rows
   - Marks the old records as superseded (if the schema supports it)
3. OR an explicit owner-approved procedure to temporarily disable the immutability trigger, perform the correction, and re-enable it

**This task does NOT perform either of these** because:
- The task explicitly forbids disabling/dropping triggers
- No safe archival mechanism exists in the schema
- The task requires explicit approval for any schema-level changes

## 8. Final Status

```text
P3-10E.14 STATUS: BLOCKED
```

### Blockers

1. **P3 tables are immutable** — direct UPDATE is rejected by the database's immutability trigger
2. **No safe archival mechanism exists** in the schema for correcting immutable P3 records
3. **Remediation requires schema-level changes** that are outside this task's scope

### What Was Accomplished

- ✅ Complete forensic audit of snapshot 7
- ✅ Confirmed snapshot 7 is invalid (0 members)
- ✅ Confirmed snapshot 2 is the authoritative baseline (7 members)
- ✅ Confirmed p3_narrative_intelligence id=1 references the invalid snapshot
- ✅ Confirmed no legitimate P3 calculation depends on snapshot 7
- ✅ Proposed remediation documented
- ✅ Owner approved the remediation
- ✅ Attempted execution (blocked by immutability)
- ✅ Verified no partial changes were made
- ✅ P0-P2 integrity maintained (narrative_health change is pre-existing pipeline data)

### Recommended Next Steps (NOT executed in this task)

1. Owner approves a schema-level remediation mechanism (migration or controlled trigger-disabling procedure)
2. Execute the approved remediation through the proper channel
3. Re-verify the corrected state
4. Proceed to P3-10E.15 (or next task) only after remediation is complete
