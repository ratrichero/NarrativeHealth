# P6-03C2 — Intelligence Snapshot Planner Decision Contract

**Date:** 2026-08-26
**Task Type:** PLANNER DECISION CONTRACT — proposed resolutions awaiting Planner acceptance
**Baseline:** P6-03C1 Decision Inventory (`cd90e10`)
**Frozen Authorities:** P6-01B/C/D/E (frozen), P6-02B/C/C1/C2 (frozen), P6-02D/E/F (implementation + audit), P6-03B (contract), P6-03C1 (inventory)
**Git boundary:** ONLY this document. No production code, schema, API, P4/P5, or P6-01/02 changes.

---

## 1. Purpose

This document converts the P6-03C1 decision inventory into a formal Planner Decision Contract. It provides exact proposed resolutions, dependency mapping, semantic audits, and persistence semantics for each of the 14 snapshot decisions.

**Critical distinction:** This document contains PROPOSED resolutions. The Agent does NOT freeze decisions. Planner acceptance is required before any resolution becomes FROZEN.

---

## 2. Decision Status Summary

| ID | Decision | Status | Classification |
|---|---|---|---|
| PD-03B-01 | Freshness weighting | **PROPOSED** | NON-BLOCKING |
| PD-03B-02 | Narrative health in V1 | **PROPOSED** | NON-BLOCKING |
| PD-03B-03 | Snapshot granularity | **PROPOSED** | NON-BLOCKING |
| PD-03B-04 | Narrative aggregation method | **PROPOSED** | NON-BLOCKING |
| PD-03B-05 | Persistence model (table) | **PROPOSED** | NON-BLOCKING |
| PD-03B-06 | Provenance scope | **PROPOSED** | NON-BLOCKING |
| PD-03B-07 | Timeframe scope | **PROPOSED** | NON-BLOCKING |
| PD-03B-08 | Version tuple | **PROPOSED** | NON-BLOCKING |
| PD-03B-09 | Persistence timing | **PROPOSED** | NON-BLOCKING |
| PD-03B-10 | Coin score source | **PROPOSED** | NON-BLOCKING |
| PD-03B-11 | Narrative input source | **PROPOSED** | NON-BLOCKING |
| PD-03B-12 | Missing data handling | **PROPOSED** | NON-BLOCKING |
| PD-03B-13 | Retention policy | **DEFERRED** | DEFERRED (V2) |
| PD-03B-14 | Membership source | **PROPOSED** | NON-BLOCKING |

---

## 3. Decision Register

### 3.1 PD-03B-01 — Freshness Weighting

**Question:** Should freshness weighting affect snapshot computation?

**Proposed Resolution:** No freshness weighting in V1. Snapshots are computed from all available features regardless of freshness.

**Alternatives Considered:**
- A: No weighting V1 ← PROPOSED
- B: STALE features receive reduced weight in narrative aggregation
- C: STALE features flagged in metadata only

**Evidence Basis:** P6-02B PD-3/PD-6 defaulted to no STALE weighting in V1. P6-02D implementation uses this default. Snapshot layer should follow the same decision for consistency.

**Rationale:** Freshness is already captured in feature-level provenance (`p6_quality_metadata.freshness_summary`). Snapshot records feature outputs; the freshness of the underlying observations is traceable through provenance. Adding weighting at the snapshot layer would create a second freshness interaction point without clear V1 benefit.

**Dependencies:** P6-02B PD-3/PD-6 (frozen default: no weighting)

**Blocking/Non-Blocking:** NON-BLOCKING

**Implementation Impact:** Low — snapshot reads feature outputs; no freshness-specific logic needed.

**Related Invariants:** IS-09 (freshness preserved as metadata), IS-10 (STALE ≠ INVALID)

**Evidence Gap:** E-1 (whether STALE weighting is needed in V1) — insufficient for override, sufficient for default.

**Planner Acceptance Criterion:** Explicitly accept Option A or specify alternative weighting formula.

---

### 3.2 PD-03B-02 — Narrative Health in V1

**Question:** Include narrative health snapshot in V1 scope?

**Proposed Resolution:** Include narrative health snapshots in V1, using market-cap weighted aggregation of coin health snapshots.

**Alternatives Considered:**
- A: Include V1 ← PROPOSED
- B: Defer to V2 (coin-level only)
- C: Include as PROPOSED, not frozen

**Evidence Basis:** P6-03A identified existing `calculateWeightedNarrativeHealth()` with market-cap weighting. P6-02C2 PD-C3 defaulted to market-cap weighted. The function already exists in `src/lib/scoring/narrative-health.ts`.

**Rationale:** The existing implementation provides sufficient evidence for a V1 contract. Market-cap weighted narrative health is the current production behavior. P6-03 adds provenance and versioning to this existing computation, not a new algorithm.

**Dependencies:** PD-03B-04 (aggregation method), PD-03B-11 (narrative input source)

**Blocking/Non-Blocking:** NON-BLOCKING

**Implementation Impact:** Medium — narrative snapshot requires member coin snapshots + membership resolution + aggregation.

**Related Invariants:** IS-01 (layer integrity), IS-05 (P6-native inputs)

**Evidence Gap:** E-2 (narrative membership count) — sufficient for V1 scope.

**Planner Acceptance Criterion:** Explicitly include or exclude narrative snapshots from V1 scope.

---

### 3.3 PD-03B-03 — Snapshot Granularity

**Question:** Snapshot granularity: per-refresh or per-day?

**Proposed Resolution:** Per-refresh, latest-only. Each refresh cycle produces at most one snapshot per entity/type. Previous snapshots are retained as SUPERSEDED.

**Alternatives Considered:**
- A: Per-refresh, latest-only ← PROPOSED
- B: Per-day (one per calendar date)
- C: Both per-refresh and per-day

**Evidence Basis:** P6-03A: legacy uses daily (`date` column). P6-01E refresh is per-trigger (not daily). IS-18 requires latest-only semantics per `(entity_type, entity_id, snapshot_type, input_window_end)`.

**Rationale:** Per-refresh aligns with the production refresh mechanism (manual or scheduled triggers). Latest-only prevents unbounded accumulation while retaining history through SUPERSEDED records. `input_window_end` replaces the legacy `date`-only identity with temporally precise reference.

**Dependencies:** PD-03B-05 (table design), PD-03B-07 (timeframe)

**Blocking/Non-Blocking:** NON-BLOCKING

**Implementation Impact:** Medium — determines unique constraint design and storage volume.

**Related Invariants:** IS-18 (latest-only semantics), IS-04 (`input_window_end` replaces date-only)

**Evidence Gap:** E-3 (production refresh frequency) — not needed for correctness, only for capacity planning.

**Planner Acceptance Criterion:** Explicitly accept per-refresh latest-only or specify alternative granularity.

---

### 3.4 PD-03B-04 — Narrative Aggregation Method

**Question:** Narrative aggregation method for V1?

**Proposed Resolution:** Market-cap weighted aggregation, reusing existing `calculateWeightedNarrativeHealth()` logic.

**Alternatives Considered:**
- A: Market-cap weighted (existing) ← PROPOSED
- B: Equal weight
- C: Configurable per version

**Evidence Basis:** P6-02C2 PD-C3 defaulted to market-cap weighted. Existing `calculateWeightedNarrativeHealth()` in `src/lib/scoring/narrative-health.ts` implements this logic.

**Rationale:** Reusing the proven existing algorithm minimizes risk and maintains behavioral consistency with current production output. P6-03 adds provenance and versioning, not a new algorithm.

**Dependencies:** PD-03B-02 (narrative inclusion)

**Blocking/Non-Blocking:** NON-BLOCKING

**Implementation Impact:** Low — reuses existing logic with added provenance.

**Related Invariants:** IS-15 (determinism)

**Evidence Gap:** E-4 (market-cap data availability) — existing function already uses market cap, so data is available.

**Planner Acceptance Criterion:** Explicitly accept market-cap weighted or specify alternative method.

---

### 3.5 PD-03B-05 — Persistence Model

**Question:** Snapshot persistence: new table or extend existing?

**Proposed Resolution:** New `p6_snapshots` table, separate from legacy `morning_snapshot_*` tables.

**Alternatives Considered:**
- A: New `p6_snapshots` table ← PROPOSED
- B: Extend `morning_snapshot_*` tables
- C: Both (dual-write during transition)

**Evidence Basis:** P6-03A identified `morning_snapshot_*` as legacy tables with date-only identity. IS-21 requires additive-only for existing schemas. IS-03 requires snapshot identity distinct from legacy.

**Rationale:** A new table provides clean separation between P6 intelligence snapshots and legacy morning snapshots. It avoids modifying legacy schemas (IS-21), prevents identity confusion (IS-03), and allows independent evolution. Legacy tables continue to serve existing P4/P5 consumers during transition.

**Dependencies:** None (foundational decision)

**Blocking/Non-Blocking:** NON-BLOCKING

**Implementation Impact:** High — determines schema design, migration, and legacy compatibility.

**Related Invariants:** IS-21 (schema additive-only), IS-22 (P5 replay boundary)

**Evidence Gap:** E-5 (morning_snapshot row count) — not needed for new table design.

**Planner Acceptance Criterion:** Explicitly accept new table or specify alternative persistence model.

---

### 3.6 PD-03B-06 — Provenance Scope

**Question:** Snapshot reconstruction scope: full or summary?

**Proposed Resolution:** Full provenance. Every snapshot records complete input references enabling reconstruction from persisted records.

**Alternatives Considered:**
- A: Full provenance (all inputs recorded) ← PROPOSED
- B: Summary + hashes
- C: Provenance-only (no reconstruction guarantee)

**Evidence Basis:** P6-03A G-4 identified no reconstruction mechanism. IS-11 requires complete provenance chain. IS-17 requires reconstruction from provenance must match original.

**Rationale:** Full provenance provides maximum traceability and enables verification (IS-17). The storage cost of JSONB provenance per snapshot is acceptable for V1. Summary+hashes would sacrifice reconstruction capability.

**Dependencies:** PD-03B-05 (table design affects storage)

**Blocking/Non-Blocking:** NON-BLOCKING

**Implementation Impact:** Medium — affects storage size and provenance query complexity.

**Related Invariants:** IS-11 (provenance chain), IS-17 (reconstruction)

**Evidence Gap:** None — provenance scope is a design choice, not an evidence-dependent decision.

**Planner Acceptance Criterion:** Explicitly accept full provenance or specify alternative scope.

---

### 3.7 PD-03B-07 — Timeframe Scope

**Question:** Add timeframe to snapshot identity?

**Proposed Resolution:** Single timeframe V1 (DAILY only). Timeframe is not part of the V1 snapshot identity.

**Alternatives Considered:**
- A: Include timeframe in identity
- B: Single timeframe V1 ← PROPOSED

**Evidence Basis:** P6-03B §14.3 explicitly limits V1 to DAILY. P6-01B frozen timeframe vocabulary includes DAILY, 4H, SOURCE_SNAPSHOT but V1 scope is DAILY only.

**Rationale:** DAILY-only limits complexity for V1. The schema can be extended with a timeframe column in V2 if multi-timeframe snapshots are needed. Prematurely including timeframe would add unnecessary complexity without V1 benefit.

**Dependencies:** None

**Blocking/Non-Blocking:** NON-BLOCKING

**Implementation Impact:** Low — single timeframe simplifies identity and calculation.

**Related Invariants:** IS-03 (identity distinct), IS-04 (`input_window_end`)

**Evidence Gap:** E-6 (multi-timeframe need) — sufficient for V1 DAILY-only scope.

**Planner Acceptance Criterion:** Explicitly accept single timeframe V1 or specify multi-timeframe requirement.

---

### 3.8 PD-03B-08 — Version Tuple

**Question:** Snapshot version tuple: standalone or reuse P6-02 feature version?

**Proposed Resolution:** Standalone snapshot version tuple, separate from feature version.

**Alternatives Considered:**
- A: Standalone snapshot version tuple ← PROPOSED
- B: Reuse feature version tuple

**Evidence Basis:** P6-03B §10.2 IS-14 requires SEPARATE version from features. Snapshot algorithm differs from feature algorithm (snapshot = aggregation of features, feature = computation from observations).

**Rationale:** Snapshot and feature algorithms are distinct. A snapshot records which feature version it consumed AND its own algorithm version. conflating them would lose the distinction between "which feature algorithm produced the input" and "which snapshot algorithm produced the output."

**Dependencies:** PD-03B-01 (freshness weighting affects snapshot algorithm)

**Blocking/Non-Blocking:** NON-BLOCKING

**Implementation Impact:** Low — additional version record per snapshot.

**Related Invariants:** IS-13 (version tuple traceability), IS-14 (separate from feature version)

**Evidence Gap:** None — version separation is a design requirement from IS-14.

**Planner Acceptance Criterion:** Explicitly accept standalone version or specify alternative versioning approach.

---

### 3.9 PD-03B-09 — Persistence Timing

**Question:** Snapshot persistence: synchronous in refresh or async post-refresh?

**Proposed Resolution:** Synchronous within refresh, after feature computation. Snapshot is part of the refresh pipeline, not a separate job.

**Alternatives Considered:**
- A: Synchronous in refresh ← PROPOSED
- B: Async background job
- C: Separate API endpoint

**Evidence Basis:** P6-01E PD-E1 established quality-before-write pattern. Consistency with feature persistence approach. IS-15 requires determinism (synchronous is simpler to verify).

**Rationale:** Synchronous persistence ensures snapshot is always consistent with the feature computation that produced it. No risk of stale snapshots if async job fails or is delayed. Aligns with existing refresh pipeline architecture.

**Dependencies:** PD-03B-05 (table design), PD-03B-03 (granularity), PD-03B-02 (narrative inclusion)

**Blocking/Non-Blocking:** NON-BLOCKING

**Implementation Impact:** Medium — affects refresh duration and error handling.

**Related Invariants:** IS-15 (determinism), IS-18 (latest-only)

**Evidence Gap:** None — timing is a design choice.

**Planner Acceptance Criterion:** Explicitly accept synchronous or specify alternative timing.

---

### 3.10 PD-03B-10 — Coin Score Source

**Question:** Coin snapshot scoring: pass-through feature health_score or recompute?

**Proposed Resolution:** Pass-through. Use the persisted feature `health_score` directly without recomputation.

**Alternatives Considered:**
- A: Pass-through feature health_score ← PROPOSED
- B: Recompute from feature dimensions
- C: Hybrid (pass-through with verification)

**Evidence Basis:** P6-02B §9.3 health_score is deterministic. IS-15 requires determinism. No need to recompute an already-deterministic value.

**Rationale:** The feature engine already computes health_score deterministically from dimensions. Recomputing at the snapshot layer would duplicate logic without benefit. Pass-through is simpler, deterministic, and preserves the exact value from the feature record.

**Dependencies:** PD-03B-01 (freshness weighting affects feature output)

**Blocking/Non-Blocking:** NON-BLOCKING

**Implementation Impact:** Low — pass-through is trivial.

**Related Invariants:** IS-15 (determinism)

**Evidence Gap:** None — pass-through is the simplest correct approach.

**Planner Acceptance Criterion:** Explicitly accept pass-through or specify recomputation requirement.

---

### 3.11 PD-03B-11 — Narrative Input Source

**Question:** Narrative snapshot input: coin snapshots or live feature reads?

**Proposed Resolution:** Read from persisted coin snapshots.

**Alternatives Considered:**
- A: Persisted coin snapshots ← PROPOSED
- B: Live feature reads
- C: Both (prefer snapshot, fallback to live)

**Evidence Basis:** IS-16 requires no live DB dependency during calculation. IS-23 requires snapshot independence. Coin snapshots are already persisted by PD-03B-09.

**Rationale:** Reading from persisted coin snapshots ensures the narrative snapshot is computed from deterministic, versioned inputs. Live feature reads would introduce a dependency on current DB state (violating IS-16). The snapshot chain (observation → feature → coin snapshot → narrative snapshot) is fully traceable.

**Dependencies:** PD-03B-02 (narrative inclusion), PD-03B-05 (table design), PD-03B-09 (persistence timing — coin snapshots must exist first)

**Blocking/Non-Blocking:** NON-BLOCKING

**Implementation Impact:** Medium — requires coin snapshots to exist before narrative snapshots in the refresh pipeline.

**Related Invariants:** IS-16 (no live DB dependency)

**Evidence Gap:** None — input source is a design requirement from IS-16.

**Planner Acceptance Criterion:** Explicitly accept persisted coin snapshots or specify alternative input source.

---

### 3.12 PD-03B-12 — Missing Data Handling

**Question:** Missing feature data: skip snapshot or persist with metadata?

**Proposed Resolution:** Persist snapshot with explicit metadata. When feature data is unavailable, persist a snapshot record with `data_completeness = 0` and appropriate quality/freshness metadata indicating missing inputs.

**Alternatives Considered:**
- A: Persist with metadata ← PROPOSED
- B: Skip snapshot entirely

**Evidence Basis:** P6-02B §4.5 existing behavior (features degrade gracefully). IS-24 (§12.4) suggests absence recording. P4/P5 already handle missing data.

**Rationale:** Persisting with metadata is consistent with existing feature behavior (neutral defaults when data is unavailable). Skipping would create gaps in the snapshot timeline. P4/P5 consumers already handle low `data_completeness` values.

**Dependencies:** PD-03B-01 (freshness weighting affects what "missing" means)

**Blocking/Non-Blocking:** NON-BLOCKING

**Implementation Impact:** Low — consistent with existing patterns.

**Related Invariants:** IS-18 (latest-only — a missing-data snapshot is still a snapshot)

**Evidence Gap:** None — missing data handling follows established patterns.

**Planner Acceptance Criterion:** Explicitly accept persist-with-metadata or specify skip behavior.

---

### 3.13 PD-03B-13 — Retention Policy

**Question:** Snapshot retention policy: keep all or expire old?

**Proposed Resolution:** DEFERRED to V2. Keep all snapshots in V1. No expiration logic.

**Alternatives Considered:**
- A: Keep all (V1) ← PROPOSED (deferred)
- B: Expire after N days
- C: Configurable retention

**Evidence Basis:** IS-18 retains SUPERSEDED snapshots. P5 historical replay may need old snapshots. Storage cost acceptable for V1.

**Rationale:** Retention policy is an operational concern, not a semantic one. V1 should establish the snapshot infrastructure; retention optimization can follow in V2 based on actual storage patterns. Deferring avoids premature optimization.

**Dependencies:** None (deferred)

**Blocking/Non-Blocking:** DEFERRED (V2 concern)

**Implementation Impact:** None for V1 — no expiration logic needed.

**Related Invariants:** IS-18 (latest-only), IS-22 (P5 replay boundary)

**Evidence Gap:** E-3 (production snapshot volume) — needed for V2 retention sizing.

**Planner Acceptance Criterion:** Accept deferral or specify V1 retention requirement.

---

### 3.14 PD-03B-14 — Membership Source

**Question:** Narrative membership source: live coin_narratives or historical membership snapshot?

**Proposed Resolution:** Live `coin_narratives` table (current membership).

**Alternatives Considered:**
- A: Live coin_narratives ← PROPOSED
- B: Historical membership snapshot

**Evidence Basis:** P6-03A identified `narrative_membership_snapshots` for historical tracking. V1 scope uses current membership. Live `coin_narratives` is the simplest correct approach.

**Rationale:** Current membership is the simplest and most correct approach for V1. Historical membership snapshots can be integrated in V2 for time-travel narrative analysis. Using live membership means the narrative snapshot reflects the current narrative composition at calculation time.

**Dependencies:** PD-03B-02 (narrative inclusion)

**Blocking/Non-Blocking:** NON-BLOCKING

**Implementation Impact:** Low — single table read.

**Related Invariants:** IS-05 (P6-native inputs — `coin_narratives` is a P6-maintained table)

**Evidence Gap:** E-2 (narrative membership count) — sufficient for V1 scope.

**Planner Acceptance Criterion:** Explicitly accept live membership or specify historical membership requirement.

---

## 4. Decision Dependencies

```
Phase 1 — Foundation:
  PD-03B-05 (table) ──────────────────────────┐
  PD-03B-03 (granularity) ────────────────────┤
  PD-03B-08 (version tuple) ─────────────────┤
                                               │
Phase 2 — Coin-Level:                          │
  PD-03B-01 (freshness) ─────────────────────┤
  PD-03B-10 (coin score) ────────────────────┤
  PD-03B-06 (provenance) ────────────────────┤
  PD-03B-07 (timeframe) ─────────────────────┤
  PD-03B-12 (missing data) ──────────────────┤
                                               │
Phase 3 — Narrative-Level:                     │
  PD-03B-02 (narrative V1) ──────────────────┤
    ├→ PD-03B-04 (agg method) ───────────────┤
    ├→ PD-03B-14 (membership) ───────────────┤
    └→ PD-03B-11 (narrative input) ──────────┤
                                               │
Phase 4 — Integration:                         │
  PD-03B-09 (persistence timing) ─────────────┘
                                               │
Deferred:                                      │
  PD-03B-13 (retention) ──── (no dependency) ─┘
```

### 4.1 Critical Path

```
PD-03B-05 → PD-03B-03 → PD-03B-09 → P6-03D implementation
```

Table design and granularity must be resolved before persistence timing can be finalized.

---

## 5. Critical Semantic Audit

### 5.1 Snapshot Identity

| Check | Status | Evidence |
|---|---|---|
| Distinct from P6-01B observation identity | ✅ CONFIRMED | IS-03, P6-03B §5.3 identity comparison |
| No date-only semantic identity | ✅ CONFIRMED | PD-03B-03 uses `input_window_end`, not `date` |
| `input_window_end` provides temporal precision | ✅ CONFIRMED | P6-03B §5.2 |

### 5.2 Quality

| Check | Status | Evidence |
|---|---|---|
| VALID/INVALID/MISSING/UNKNOWN unchanged | ✅ CONFIRMED | IS-06, IS-08 |
| No new QualityState | ✅ CONFIRMED | Lifecycle states are NOT quality states (IS-19) |
| Snapshot does not reinterpret quality | ✅ CONFIRMED | IS-07 — quality metadata is recorded, not applied to scores |

### 5.3 Freshness

| Check | Status | Evidence |
|---|---|---|
| Independent dimension | ✅ CONFIRMED | IS-09, IS-10 |
| STALE ≠ INVALID | ✅ CONFIRMED | IS-10 |
| No V1 weighting (PD-03B-01) | ✅ PROPOSED | Freshness recorded in provenance only |

### 5.4 Provenance

| Check | Status | Evidence |
|---|---|---|
| snapshot → feature → observation trace possible | ✅ CONFIRMED | IS-11, PD-03B-06 full provenance |
| No fabricated observation IDs | ✅ CONFIRMED | Provenance references real persisted feature records |

### 5.5 Versioning

| Check | Status | Evidence |
|---|---|---|
| Snapshot version ≠ feature version | ✅ CONFIRMED | IS-14, PD-03B-08 standalone version |
| Structured version semantics preserved | ✅ CONFIRMED | IS-13, PD-03B-08 |

### 5.6 P4/P5

| Check | Status | Evidence |
|---|---|---|
| No P4/P5 modifications | ✅ CONFIRMED | IS-20 |
| No BUY/SELL/action/policy semantics | ✅ CONFIRMED | IS-02 |
| No snapshot insertion into P5 replay chain | ✅ CONFIRMED | IS-22, IS-23 |

---

## 6. Narrative Semantics

### 6.1 Atomic Input

The coin snapshot is the atomic input for narrative aggregation. Each coin snapshot contains:

- `health_score` (pass-through from feature)
- `feature_version_id` (which feature version produced it)
- `data_completeness` (proportion of available inputs)
- `quality_metadata` (quality landscape of inputs)

### 6.2 Aggregation

The narrative snapshot aggregates coin snapshots using:

- **Method:** Market-cap weighted (PD-03B-04)
- **Input:** Array of coin snapshots for current narrative members (PD-03B-14)
- **Weighting:** Market cap from `coin_metrics` table

### 6.3 Missing Member Behavior

When a member coin has no current coin snapshot:

- The coin is **excluded** from narrative aggregation
- `data_completeness` reflects the proportion of members with snapshots
- No health value is invented for the missing member
- `narrative_metadata.member_count_expected` vs `member_count_actual` records the gap

**Critical rule:** No invented health value for missing members. The narrative health reflects only available coin health data.

### 6.4 Narrative Completeness Metadata

```
NarrativeCompletenessMetadata
├── member_count_expected       (total coins in narrative)
├── member_count_actual         (coins with current snapshots)
├── member_completeness         (actual / expected × 100)
├── missing_member_ids[]        (coins without snapshots)
└── narrative_data_completeness (overall completeness)
```

### 6.5 No BUY/SELL Semantics

Narrative snapshots record intelligence state only. They do NOT produce:

- Buy/sell signals
- Action permissions
- Trading recommendations
- Risk assessments

---

## 7. Persistence Semantics

### 7.1 Insert/Upsert

| Aspect | Proposed Behavior |
|---|---|
| First calculation | INSERT new row |
| Subsequent calculation (same entity/type/window_end) | UPDATE existing row (latest-only) |
| Different entity/type/window_end | INSERT new row |

### 7.2 Latest-Only

For each `(entity_type, entity_id, snapshot_type, input_window_end)`:

- Only one row is CURRENT at any time
- Previous rows are marked SUPERSEDED
- No rows are deleted (retention = keep all in V1)

### 7.3 CURRENT/SUPERSEDED Lifecycle

| State | Definition | Query Pattern |
|---|---|---|
| CURRENT | Latest snapshot for this entity/type/window_end | Primary read path |
| SUPERSEDED | Older snapshot replaced by a newer one | Historical/replay path |

State transitions:

```
INSERT → CURRENT
  ↓ (newer snapshot for same identity)
UPDATE previous → SUPERSEDED
INSERT new → CURRENT
```

### 7.4 Idempotency

| Scenario | Behavior |
|---|---|
| Same calculation repeated | Same output → UPDATE with identical values (idempotent) |
| Different calculation, same identity | UPDATE with new values (latest-only) |
| Different identity | INSERT new row |

### 7.5 Duplicate Refresh

If the same refresh produces two calculations for the same entity:

- First calculation: INSERT → CURRENT
- Second calculation: UPDATE → CURRENT (replaces first)
- No duplicate rows

### 7.6 Calculation Timestamp

`calculation_time` is UTC wall-clock at the moment of calculation.

- NOT part of deterministic identity (IS-15)
- For provenance only (IS-11)
- Different between original and reconstruction (expected and correct)

### 7.7 Failure Boundary

| Failure Type | Behavior | Quality State |
|---|---|---|
| Feature read failure | Infrastructure error — snapshot not persisted | N/A (no snapshot created) |
| Snapshot calculation failure | Infrastructure error — snapshot not persisted | N/A |
| Persistence failure | Infrastructure error — return null (PD-E2 pattern) | N/A (NOT a quality state) |
| Quality classification | Never blocks snapshot creation (IS-07) | Metadata only |

**Critical distinction:** Persistence failure is an infrastructure error, NOT a quality state. The snapshot layer MUST NOT convert DB errors into quality classifications.

### 7.8 Persistence Failure vs Quality State

| Concept | Snapshot Behavior |
|---|---|
| Feature has VALID observations | Snapshot records quality metadata showing VALID |
| Feature has INVALID observations | Snapshot records quality metadata showing INVALID — but snapshot is still created |
| Feature is entirely MISSING | Snapshot created with data_completeness = 0 (PD-03B-12) |
| DB write fails | Infrastructure error — snapshot not persisted; no quality state created |

---

## 8. Evidence Gaps

| Gap ID | From | What Is Unknown | Why It Matters | Can Implementation Proceed? | Required Future Evidence |
|---|---|---|---|---|---|
| E-1 | P6-03B | Whether STALE weighting is needed in V1 | Affects snapshot computation | YES — default is safe (no weighting) | Production observation of stale data impact |
| E-2 | P6-03B | Narrative membership count and distribution | Performance planning | YES — V1 scope is limited | Production DB query |
| E-3 | P6-03B | Production refresh frequency and snapshot volume | Storage/capacity planning | YES — latest-only limits accumulation | Production monitoring |
| E-4 | P6-03B | Market-cap data availability for narrative weighting | PD-03B-04 implementation | YES — existing function already uses market cap | Verify coin_metrics has market_cap for all coins |
| E-5 | P6-03B | morning_snapshot_headers row count and schema details | PD-03B-05 table design | YES — new table avoids legacy dependency | Production DB inspection (V2 concern) |
| E-6 | P6-03B | Whether multi-timeframe snapshots are needed | PD-03B-07 identity design | YES — V1 is DAILY only | Product requirement clarification (V2 concern) |

**All evidence gaps are non-blocking.** Implementation can proceed safely with proposed defaults.

---

## 9. Planner Acceptance Gate

### 9.1 Conditions for P6-03D Implementation

P6-03D (Implementation) MAY begin when ALL of the following are true:

| # | Gate | Status |
|---|---|---|
| 1 | PD-03B-05 (table design) accepted | ⏳ PENDING |
| 2 | PD-03B-03 (granularity) accepted | ⏳ PENDING |
| 3 | PD-03B-02 (narrative V1 scope) accepted | ⏳ PENDING |
| 4 | PD-03B-09 (persistence timing) accepted | ⏳ PENDING |
| 5 | P6-03B contract frozen | ✅ DONE |
| 6 | P6-03C1 inventory complete | ✅ DONE |
| 7 | P6-02D/E/F frozen (upstream) | ✅ DONE |

### 9.2 Decisions Implementation Must Not Reinterpret

Even if not formally frozen, implementation MUST use the proposed defaults for:

| Decision | Why |
|---|---|
| PD-03B-01 | No freshness weighting — feature outputs already reflect this |
| PD-03B-06 | Full provenance — reconstruction guarantee requires this |
| PD-03B-07 | Single timeframe — V1 scope constraint |
| PD-03B-08 | Standalone version — IS-14 requires separation |
| PD-03B-10 | Pass-through — IS-15 determinism requirement |
| PD-03B-11 | Persisted inputs — IS-16 live-DB prohibition |
| PD-03B-12 | Persist with metadata — consistent with feature behavior |
| PD-03B-14 | Live membership — V1 simplicity |

### 9.3 Planner Acceptance Checklist

| # | Item | Acceptance |
|---|---|---|
| 1 | PD-03B-01: No freshness weighting V1 APPROVED | [ ] |
| 2 | PD-03B-02: Narrative health in V1 APPROVED | [ ] |
| 3 | PD-03B-03: Per-refresh latest-only APPROVED | [ ] |
| 4 | PD-03B-04: Market-cap weighted APPROVED | [ ] |
| 5 | PD-03B-05: New p6_snapshots table APPROVED | [ ] |
| 6 | PD-03B-06: Full provenance APPROVED | [ ] |
| 7 | PD-03B-07: Single timeframe V1 APPROVED | [ ] |
| 8 | PD-03B-08: Standalone version tuple APPROVED | [ ] |
| 9 | PD-03B-09: Synchronous persistence APPROVED | [ ] |
| 10 | PD-03B-10: Pass-through feature health_score APPROVED | [ ] |
| 11 | PD-03B-11: Persisted coin snapshots as input APPROVED | [ ] |
| 12 | PD-03B-12: Persist with metadata APPROVED | [ ] |
| 13 | PD-03B-13: Retention deferred to V2 ACCEPTED | [ ] |
| 14 | PD-03B-14: Live coin_narratives membership APPROVED | [ ] |

---

## 10. Invariants

### 10.1 Snapshot-Specific Invariants (New)

| ID | Invariant | Source | Violation |
|---|---|---|---|
| **IS-24** | Snapshot persistence failure is infrastructure error, NOT quality state | PD-03B-09, PD-E2 pattern | CLASS-A |
| **IS-25** | Coin snapshot must exist before narrative snapshot in refresh pipeline | PD-03B-09, PD-03B-11 | CLASS-B |
| **IS-26** | Narrative snapshot MUST NOT invent health values for missing members | PD-03B-12, §6.3 | CLASS-A |
| **IS-27** | Snapshot CURRENT/SUPERSEDED lifecycle states are NOT QualityState values | IS-19, §7.3 | CLASS-A |
| **IS-28** | Snapshot uniqueness is per (entity_type, entity_id, snapshot_type, input_window_end) | PD-03B-03, IS-18 | CLASS-B |

### 10.2 Existing Invariants Preserved

All P6-01 (IS-01…IS-23) and P6-02 (DF-01…DF-16) invariants remain unchanged.

---

## 11. Readiness Matrix

| Metric | Count |
|---|---|
| **Total decisions** | **14** |
| **Blocking** | **0** |
| **Non-blocking** | **13** |
| **Deferred** | **1** (PD-03B-13 retention) |
| **Evidence gaps** | **6** (all non-blocking) |
| **New invariants** | **5** (IS-24…IS-28) |
| **Implementation readiness** | **READY** (all defaults safe) |
| **Freeze readiness** | **PENDING** (Planner acceptance required) |

---

## 12. Acceptance Checklist

- [x] All 14 decisions represented with proposed resolutions
- [x] No decision silently frozen
- [x] Dependency graph documented
- [x] Semantic audit passed (identity, quality, freshness, provenance, versioning, P4/P5)
- [x] Narrative semantics documented (atomic input, aggregation, missing members, completeness)
- [x] Persistence semantics defined (insert/upsert, latest-only, lifecycle, idempotency, failure boundary)
- [x] Evidence gaps carried from C1/B with implementation safety assessment
- [x] Planner acceptance gate defined
- [x] Invariants created (IS-24…IS-28) without renumbering existing
- [x] Readiness matrix produced
- [x] No production code modified
- [x] No schema/migration changes
- [x] No P4/P5 changes
- [x] No P6-01/02 changes
- [x] No decisions frozen by agent
