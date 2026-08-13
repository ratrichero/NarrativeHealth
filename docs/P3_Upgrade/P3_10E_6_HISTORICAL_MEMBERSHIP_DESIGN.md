# P3-10E.6 Historical Membership Schema & Snapshot Design

Design date: 2026-08-10  
Scope: implementation-ready design only  
Schema/code/data changes performed: none

## 1. Executive Summary

P3 requires one authoritative constituent set for narrative `N` at calculation `window_end = T`. Current `coin_narratives` cannot resolve historical state, and the existing `p3_constituent_snapshots` table is a calculation-output attachment rather than a pre-calculation authority.

The recommended architecture is **Option C — Hybrid**:

1. an append-only, effective-dated membership event ledger records every membership mutation;
2. an independent immutable membership snapshot is materialized from that ledger for the requested `window_end` before P3 calculation;
3. every P3 result references the exact membership snapshot it consumed;
4. the existing `p3_constituent_snapshots` remains a calculation-output/input-manifest artifact and is not overloaded as the membership source of truth.

This design supports delayed calculations correctly. A calculation run on 2026-08-10 for `window_end = 2026-08-03` resolves ledger state effective at 2026-08-03; it never snapshots current 2026-08-10 membership as observed history.

Historical repository evidence before rollout is partial but not authoritative. No existing production date can be declared fully trustworthy from repository data alone. The earliest authoritative date will be the verified membership-ledger cutover timestamp for each narrative.

```text
membership mutation
        -> append-only effective event ledger
        -> resolve state at window_end
        -> immutable membership snapshot
        -> shared P3 execution context
        -> P3-04 ... P3-09
        -> immutable P3 intelligence + calculation artifact
```

## 2. P3 Historical Membership Contract

For narrative `N` and calculation window `W` ending at `T`:

```text
authoritative_constituents(N, T) = membership state effective at T
```

The resolver must apply the approved boundary rule consistently:

```text
event.effective_at <= T
```

For interval representations, the equivalent rule is:

```text
effective_from <= T
AND (effective_to IS NULL OR T < effective_to)
```

The resolved immutable snapshot is part of the shared P3 execution context. P3-04 Breadth, P3-05 Momentum provenance, P3-06 constituent universe where applicable, P3-07 Leadership, P3-08 Regime, and P3-09 Rotation must all use or inherit that same snapshot identity. P3-05 may calculate from persisted narrative-health observations, and the BTC side of P3-06 remains a global benchmark, but neither may independently resolve a different narrative membership set.

No P3 module may query current `coin_narratives` to resolve observed historical membership.

## 3. Existing Sources Audit

Repository-wide searches covered effective/valid date fields, removal timestamps, history/audit tables, snapshots, `coin_narratives`, and all direct membership writes.

### Existing data sources

| Source | What it knows | Why it is insufficient |
|---|---|---|
| `coin_narratives` | Current pair, `is_primary`, row `created_at` | No removal, prior primary state, effective interval, actor, or immutable audit |
| `narrative_health.coin_breakdown` | Coins with health rows used in a daily health calculation | Output-derived, incomplete when health is missing, and upsert-mutable |
| `narrative_health.coin_count` | Count of coins with health inputs | Does not identify omitted members or prove full membership |
| Legacy morning snapshot | Narrative aggregates/counts | Does not map narrative to constituent coin IDs |
| Normalized morning snapshots | Global coin facts and narrative aggregates | No narrative-member join snapshot |
| Existing P3 snapshots | Members attached to an intelligence result | Created after result insertion; no production rows; not independent authority |
| Alert/scheduler/event tables | Operational or market events | No membership mutation history |

No `effective_from`, `effective_to`, `valid_from`, `valid_to`, `removed_at`, coin-narrative audit table, or complete membership snapshot source exists.

### Membership mutation paths

The application knows request/transaction time when a change is executed, but does not persist it as membership history:

- Next.js coin creation inserts initial `coin_narratives` rows.
- Next.js coin update deletes all mappings for a coin, then reinserts the submitted list. This is not currently one explicit application transaction.
- Next.js coin deletion explicitly deletes mappings and then the coin.
- Next.js narrative deletion cascades through `coin_narratives`.
- Admin seed inserts membership.
- The parallel Python backend has equivalent create/update/seed/delete paths; its update also replaces all associations.
- Direct database writes would bypass application-only logging.

Therefore capture must be enforced at the database boundary or through one database-owned mutation procedure used by every writer. Application-route instrumentation alone is not complete enough.

## 4. Historical Reconstruction Analysis

Overall classification:

```text
PARTIAL
```

Production health breakdowns prove that historical calculation populations changed. They can identify some included coins on some dates. Current membership timestamps identify when surviving rows were inserted. However the repository cannot prove:

- whether a coin omitted from `coin_breakdown` was not a member or merely lacked health data;
- exact removal times;
- prior `is_primary` values;
- membership changes between daily health observations;
- whether old rows were recalculated through upsert;
- all changes caused by coin/narrative deletion or direct SQL.

Consequently repository evidence supports forensic, owner-assisted reconstruction only. It cannot support an automatic authoritative backfill.

## 5. Option A — Effective-Dated Ledger

### Design

Record every membership state transition with an effective timestamp. An append-only event form is preferred to a mutable interval row:

```text
narrative_membership_events
  narrative_id
  coin_id
  event_type: ADDED | REMOVED | PRIMARY_SET
  effective_at
  recorded_at
  source / actor / provenance
```

State at `T` is determined by the latest deterministic event for each narrative/coin at or before `T`.

### Strengths

- Resolves arbitrary historical timestamps after cutover.
- Captures additions, removals, and primary-state changes.
- Supports delayed or replayed calculations.
- Append-only events retain transaction-time and effective-time evidence.

### Weaknesses

- Every mutation path must be captured atomically.
- Replacement-style updates generate multiple events and require deterministic ordering.
- Querying/folding events for every component is error-prone if not materialized once.
- A ledger alone does not freeze the exact set used by a completed calculation.

Assessment: necessary source of truth, but insufficient alone for simple P3 replay provenance.

## 6. Option B — Periodic Snapshots

### Design

Capture a complete immutable set at a scheduled time or before a P3 calculation.

### Strengths

- Simple exact member set and digest.
- Efficient read path.
- Naturally attaches to a calculation.
- Strong replay evidence.

### Weaknesses

- A snapshot taken at execution time does not prove membership at an earlier `window_end`.
- Daily snapshots can miss intraday changes and cannot resolve arbitrary timestamps.
- A calculation-before-snapshot gap remains if capture is not transactional.
- Historical windows before the first snapshot remain unknowable.

Assessment: sufficient only prospectively for windows captured at the correct boundary; insufficient as the sole general historical source.

## 7. Option C — Hybrid

### Design

Use the effective-dated ledger as historical truth and materialize one immutable execution snapshot from the ledger state at the requested `window_end`.

### Strengths

- Correct for delayed calculations.
- Resolves membership once and shares it across all P3 components.
- Freezes exact calculation inputs and provenance.
- Separates membership truth from algorithm/config/result identity.
- Supports efficient replay and auditing.

### Weaknesses

- Requires both mutation capture and snapshot materialization.
- Requires a defined late-correction/revision policy.
- Cannot recreate pre-cutover history without independent evidence.

Assessment: satisfies the full P3 contract with bounded additive schema changes.

## 8. Architecture Comparison

| Requirement | Option A: Ledger | Option B: Snapshots | Option C: Hybrid |
|---|---:|---:|---:|
| Delayed historical calculation | PASS after cutover | FAIL unless exact prior snapshot exists | PASS after cutover |
| Exact calculation input replay | PARTIAL | PASS | PASS |
| Every membership mutation represented | PASS | PARTIAL | PASS |
| Efficient P3 read boundary | PARTIAL | PASS | PASS |
| Immutable member set per result | PARTIAL | PASS | PASS |
| Arbitrary `window_end` after cutover | PASS | PARTIAL | PASS |
| Clean separation from P3 output | PASS | PASS if independent | PASS |
| Operational complexity | Medium | Low | Medium |

Recommendation: **Option C — Hybrid**.

## 9. Recommended Architecture

The architecture has four distinct layers:

```text
coin_narratives
  current operational projection for P0-P2
        |
        | every mutation captured
        v
narrative_membership_events
  effective-dated source of truth after cutover
        |
        | resolve state at exact window_end
        v
narrative_membership_snapshots + members
  immutable authoritative P3 input
        |
        | membership_snapshot_id
        v
p3_narrative_intelligence
  immutable calculation result
        |
        v
p3_constituent_snapshots + members
  calculation eligibility/input-manifest artifact
```

`coin_narratives` remains the current-state table. The new ledger makes changes historical. The new membership snapshot freezes a resolved set. The existing P3 constituent tables continue documenting eligibility and component input availability for the result.

## 10. Authoritative Snapshot Lifecycle

The required capture model is a hybrid of mutation capture and pre-calculation materialization:

1. **Every membership mutation:** append effective membership events in the same database transaction as the current-state change.
2. **Before every P3 calculation:** call the single membership resolver for `narrativeId` and `windowEnd`.
3. **Existing snapshot:** verify identity/digest and reuse it.
4. **No snapshot, ledger covers `windowEnd`:** fold ledger events effective at `windowEnd`, create the immutable membership snapshot and members transactionally, then calculate.
5. **Ledger does not cover `windowEnd`:** return `NO_SNAPSHOT`; do not use current membership.
6. **Scheduled daily capture:** optional optimization/coverage monitor, not the source of truth.

The snapshot timestamp is the membership as-of boundary (`window_end`), while `captured_at` is when materialization happened. They must remain separate fields.

## 11. Proposed Schema

No migration SQL is included in this design.

### `narrative_membership_events`

| Column | Type/semantics |
|---|---|
| `id` | bigint identity primary key; deterministic tie-breaker |
| `narrative_id` | integer, required narrative identity |
| `coin_id` | integer, required coin identity |
| `event_type` | `ADDED`, `REMOVED`, or `PRIMARY_SET` |
| `is_primary` | nullable except where event semantics require it |
| `effective_at` | timestamptz; business-effective boundary |
| `recorded_at` | timestamptz; database insertion time |
| `source` | API/backend/seed/admin/import/database source |
| `source_ref` | request/job/import reference where available |
| `actor` | nullable actor/service identity |
| `idempotency_key` | stable unique mutation key |
| `provenance` | non-null JSONB metadata |

Corrections are new append-only events with explicit provenance; existing events are never updated or deleted.

### `narrative_membership_snapshots`

| Column | Type/semantics |
|---|---|
| `id` | bigint identity primary key |
| `narrative_id` | integer, required |
| `window_end` | timestamptz; state boundary resolved |
| `snapshot_revision` | integer, default 1; explicit correction revision |
| `membership_mode` | observed/simulation/corrected-observed policy value |
| `membership_source` | normally `membership_event_ledger` |
| `ledger_cutoff_event_id` | highest event included in resolution |
| `member_count` | exact full member count |
| `member_digest` | deterministic digest of ordered member facts |
| `captured_at` | materialization time |
| `provenance` | non-null JSONB including cutover/coverage information |

### `narrative_membership_snapshot_members`

| Column | Type/semantics |
|---|---|
| `snapshot_id` | parent membership snapshot |
| `coin_id` | constituent identity |
| `is_primary` | membership attribute effective at `window_end` |
| `membership_state` | normally `MEMBER`; reserved explicit state vocabulary |
| `source_event_id` | event supporting the resolved state |
| `provenance` | optional member-level evidence |

### P3 result linkage

Add `membership_snapshot_id` to `p3_narrative_intelligence`. New constituent-dependent observed results must reference the exact authoritative membership snapshot. Existing `p3_constituent_snapshots` remains an output artifact linked to intelligence and may include the membership snapshot ID in provenance, but it is not renamed or repurposed.

## 12. Constraints & Indexes

Required constraints:

- event primary key on `id`;
- event-type and required-field checks;
- unique event `idempotency_key`;
- snapshot primary key on `id`;
- unique `(narrative_id, window_end, snapshot_revision, membership_mode)`;
- member primary key `(snapshot_id, coin_id)`;
- `snapshot_revision > 0`;
- `member_count >= 0`;
- snapshot-member count/digest validation in the snapshot creation transaction;
- P3 result FK `membership_snapshot_id -> narrative_membership_snapshots.id`.

Required indexes:

- events `(narrative_id, effective_at, id)`;
- events `(narrative_id, coin_id, effective_at, id)`;
- events `(coin_id, effective_at)`;
- snapshots `(narrative_id, window_end)`;
- snapshot members `(coin_id, snapshot_id)`;
- P3 intelligence index on `membership_snapshot_id`.

Identity foreign keys should use `ON DELETE RESTRICT`, consistent with immutable P3 history. Once authoritative history references a coin or narrative, destructive deletion must not erase its identity; deactivation is the safe operational action. This does not change `coin_narratives` current-state meaning, but it does require the rollout verification to confirm admin hard-delete behavior and communicate the historical-retention rule.

Deterministic snapshot serialization orders members by `coin_id` and includes at least `coin_id`, `is_primary`, and membership state in the digest.

## 13. Immutability

The following tables are append-only/immutable:

- `narrative_membership_events`: INSERT only;
- `narrative_membership_snapshots`: INSERT only;
- `narrative_membership_snapshot_members`: INSERT only.

Database triggers must reject UPDATE and DELETE. Application permissions should separately deny UPDATE/DELETE for the runtime role. Snapshot creation occurs in one transaction with an advisory/row-level lock on the narrative/window identity to prevent concurrent duplicate or divergent snapshots.

Late corrections never mutate an existing snapshot. They append correction events and require an explicitly requested `snapshot_revision`. Historical P3 results continue referencing their original revision. Corrected recalculation must create a new, traceable P3 identity/result rather than silently replacing observed history.

## 14. Preparation API Contract

The sole P3 membership boundary is:

```ts
resolveP3Membership(
  narrativeId: number,
  windowEnd: Date,
  options?: {
    mode?: "observed" | "simulation" | "corrected-observed";
    snapshotRevision?: number;
  }
): Promise<{
  narrativeId: number;
  windowEnd: Date;
  constituents: ReadonlyArray<{
    coinId: number;
    isPrimary: boolean;
    membershipState: "MEMBER";
  }>;
  source: "membership_snapshot" | "membership_event_ledger";
  snapshotId: number | null;
  snapshotRevision: number | null;
  memberDigest: string | null;
  availability: "AVAILABLE" | "NO_SNAPSHOT" | "PARTIAL_HISTORY" | "INVALID_SNAPSHOT";
  reason?: string;
}>;
```

For `AVAILABLE`, the resolver returns an existing immutable snapshot or atomically materializes one from covered ledger history. The execution context is frozen and passed to every P3 component.

No P3-04 through P3-09 implementation may directly query `coin_narratives` for historical membership.

## 15. Missing Data Semantics

The resolver rules are explicit:

| Condition | Availability | Behavior |
|---|---|---|
| Exact immutable snapshot exists | `AVAILABLE` | Use it |
| Ledger coverage includes `windowEnd` and snapshot can be materialized | `AVAILABLE` | Create/reuse snapshot, then calculate |
| `windowEnd` precedes trustworthy ledger coverage | `NO_SNAPSHOT` | Stop constituent-dependent authoritative calculation |
| Only partial forensic evidence exists | `PARTIAL_HISTORY` | Audit/display only; not observed calculation input |
| Count/digest/member constraints fail | `INVALID_SNAPSHOT` | Fail closed |

`NO_SNAPSHOT` must never become current membership or an empty member set. An authoritative empty set is distinct: it requires an actual immutable snapshot with `member_count = 0` and explicit provenance. Component contracts then decide whether that valid empty set yields `INSUFFICIENT_HISTORY` or another unavailable state.

## 16. Historical Backfill Strategy

Backfill classification:

```text
PARTIAL, only with independently verified evidence
```

Automated authoritative backfill from repository production tables alone is:

```text
IMPOSSIBLE
```

Allowed sources for a historical backfill must prove the complete set, including unavailable members and removals, at a precise effective boundary. Examples could include repository-owner records, provider exports, database audit/WAL records, or another independently verified system of record.

`narrative_health.coin_breakdown` may corroborate a proposed set but cannot establish completeness. Current `coin_narratives` may seed the cutover baseline but must not be backdated before verification.

Backfilled events/snapshots must be marked with source, verification authority, evidence reference, and confidence. Unprovable dates remain `NO_SNAPSHOT`.

## 17. Earliest Trustworthy Date

No current production date qualifies as `FULL` authoritative membership based only on repository data.

| Narrative | Evidence classification | Earliest partial evidence | Earliest authoritative date |
|---|---|---|---|
| AI | PARTIAL | 2026-07-31 health/member evidence | Future verified ledger cutover timestamp |
| TOPMC | PARTIAL | 2026-08-02 membership/health evidence | Future verified ledger cutover timestamp |
| RWA | PARTIAL | 2026-08-02 health/member evidence | Future verified ledger cutover timestamp |
| RESTAKING | PARTIAL | 2026-08-07 membership/health evidence | Future verified ledger cutover timestamp |
| FAVORITE | PARTIAL | 2026-08-02 membership/health evidence | Future verified ledger cutover timestamp |

The rollout must persist a per-narrative `history_coverage_start` or equivalent provenance value. If all five baselines are owner-verified in one controlled transaction, they may share one cutover timestamp. Before that timestamp, observed historical P3 calculations remain unavailable unless a separately verified backfill exists.

## 18. Migration Plan

### Phase 1 — Schema deployment

Create ledger/snapshot tables, constraints, indexes, triggers, permissions, and nullable P3 snapshot linkage. Do not switch P3 reads.

### Phase 2 — Membership history capture

Enable database-boundary capture for all insert/delete/primary changes. Make replacement-style membership writes atomic. Reconcile emitted events against `coin_narratives`.

### Phase 3 — Historical backfill

Insert only independently proven history. Record unverifiable periods as uncovered; never infer removals from health rows.

### Phase 4 — P3 preparation switch

Implement `resolveP3Membership()`, create the shared frozen execution context, and remove direct historical membership reads from P3 modules.

### Phase 5 — Verification

Test delayed windows, add/remove/primary transitions, missing snapshot behavior, concurrency, digest stability, correction revisions, and replay against exact snapshot IDs.

### Phase 6 — Production activation

Owner-verify current baselines, record cutover coverage, activate authoritative P3 reads in a controlled release, and only then run the separately approved production verification.

## 19. P0-P2 Compatibility

The design is additive:

- `coin_narratives` remains the current operational membership projection.
- P0-P2 queries and formulas continue reading it unchanged.
- `narrative_health` schema and calculation behavior are unchanged.
- `/api/refresh` is unchanged by the schema/design phase.
- Existing score/config tables and threshold behavior are unchanged.
- The scheduler is not activated or modified by this design.

Future capture must observe membership writes without changing their logical current-state result. Making multi-statement replacement writes atomic is a correctness hardening step and must be verified separately. Historical FK retention may block destructive deletion of referenced identities; deactivation should be used after history activation, consistent with immutable P3 records.

## 20. Production Rollout

Production safety gates:

1. backup verified before schema deployment;
2. migration executed separately and one step at a time;
3. runtime roles verified for append-only history;
4. current membership hash/count reconciled before and after enabling capture;
5. one controlled mutation test in a non-production clone before production enablement;
6. baseline snapshot signed off by the repository owner;
7. `history_coverage_start` recorded per narrative;
8. resolver shadow comparison without P3 persistence;
9. authoritative calculation allowed only for covered windows;
10. rollback disables new readers/writers without deleting captured history.

No snapshot population, migration, or activation is authorized by P3-10E.6.

## 21. Risks

| Risk | Mitigation |
|---|---|
| Application-only logging misses Python/direct SQL/cascades | Database trigger or database-owned mutation procedure |
| Delete/reinsert update creates transient gaps | One transaction and deterministic effective timestamp/order |
| Execution-time snapshot used for older window | Resolve ledger state at `window_end`; enforce coverage |
| Partial health evidence promoted to truth | Mark `PARTIAL_HISTORY`; require independent verification |
| Concurrent snapshot creation diverges | Unique identity, transaction lock, digest comparison |
| Late correction silently changes history | Append correction event, explicit snapshot revision and new P3 result |
| Current entity hard delete breaks historical references | `RESTRICT`, retain/deactivate identities |
| Snapshot and members disagree | Transactional count/digest validation |
| Different P3 modules resolve different sets | Single resolver and frozen shared execution context |
| Pre-cutover windows accidentally run as observed | Fail closed with `NO_SNAPSHOT` |

## 22. Final Recommendation

Adopt **Option C — Hybrid**:

```text
append-only effective membership ledger
        +
independent immutable membership snapshots
        +
mandatory membership_snapshot_id on new P3 observed results
```

This is the smallest complete design that supports delayed historical calculation, exact replay, immutable provenance, one constituent boundary across P3-04 through P3-09, and continued P0-P2 use of current `coin_narratives`.

The implementation task must preserve the semantic distinction:

```text
membership snapshot = authoritative calculation input
p3_constituent_snapshot = calculation eligibility/output manifest
```

Historical data before the verified cutover remains unavailable unless independently proven. No current membership or partial health breakdown may be silently substituted.

```text
P3-10E.6 STATUS: DESIGN PASS
```

Hard stop observed. No migration SQL, schema implementation, snapshot insertion, historical backfill, preparation change, orchestrator run, `/api/refresh` modification, or P3-11 work was performed.
