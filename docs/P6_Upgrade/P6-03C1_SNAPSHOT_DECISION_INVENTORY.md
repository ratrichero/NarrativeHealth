# P6-03C1 — Intelligence Snapshot Decision Inventory

**Date:** 2026-08-26
**Task Type:** INVENTORY ONLY — no implementation, no resolution, no freeze
**Baseline:** P6-03B Intelligence Snapshot Contract (`2f9c8d5`)
**Git boundary:** ONLY this document. No production code, schema, API, P4/P5, or P6-01/02 changes.

---

## 1. Purpose

This document converts the P6-03B contract's Planner Decisions into a formal decision inventory with evidence analysis, dependency mapping, and readiness assessment for P6-03C2 (Planner Decision Contract).

**Critical distinction:** This document contains INVENTORY and PROPOSED defaults. The Agent does NOT freeze, resolve, or implement any decision.

---

## 2. Decision Inventory

### 2.1 Explicit Decisions (from P6-03B)

| ID | Question | Proposed Default | Evidence | Alternatives | Dependency | Blocking | Evidence Sufficiency | Affected Invariants | Implementation Impact | Required Before P6-03D |
|---|---|---|---|---|---|---|---|---|---|---|
| PD-03B-01 | Should freshness weighting affect snapshot computation? | A: No weighting V1 | P6-02B PD-3/PD-6 defaulted to no STALE weighting; P6-02D implemented with this default | B: STALE reduced weight in narrative agg; C: STALE flagged only | P6-02B PD-3/PD-6 | NON-BLOCKING | SUFFICIENT | IS-09, IS-10 | Low — snapshot records feature outputs, freshness already captured in feature provenance | YES |
| PD-03B-02 | Include narrative health snapshot in V1? | A: Include V1 | P6-03A identified existing `calculateWeightedNarrativeHealth()`; P6-02C2 PD-C3 defaulted to market-cap weighted | B: Defer to V2; C: Include as PROPOSED only | P6-02B PD-8 | NON-BLOCKING | SUFFICIENT | IS-01, IS-05 | Medium — narrative snapshot requires member coin snapshots + membership resolution | YES |
| PD-03B-03 | Snapshot granularity: per-refresh or per-day? | A: Per-refresh, latest-only | P6-03A: legacy uses daily; P6-01E refresh is per-trigger; IS-18 requires latest-only | B: Per-day; C: Both | None | NON-BLOCKING | SUFFICIENT | IS-18 | Medium — determines unique constraint design and storage volume | YES |
| PD-03B-04 | Narrative aggregation method for V1? | A: Market-cap weighted (existing) | P6-02C2 PD-C3 defaulted to market-cap weighted; existing `calculateWeightedNarrativeHealth()` uses this | B: Equal weight; C: Configurable | PD-03B-02 | NON-BLOCKING | SUFFICIENT | IS-15 | Low — reuses existing logic, just adds provenance | YES |
| PD-03B-05 | Snapshot persistence: new table or extend existing? | A: New `p6_snapshots` table | P6-03A: morning_snapshot_* tables are legacy; IS-21 requires additive-only; clean separation preferred | B: Extend morning_snapshot_*; C: Both | None | NON-BLOCKING | SUFFICIENT | IS-21, IS-22 | High — determines schema design, migration, and legacy compatibility | YES |
| PD-03B-06 | Snapshot reconstruction scope: full or summary? | A: Full provenance | P6-03A G-4 identified no reconstruction mechanism; IS-11, IS-17 require full chain; maximum traceability | B: Summary + hashes; C: Provenance-only | None | NON-BLOCKING | SUFFICIENT | IS-11, IS-17 | Medium — affects storage size and provenance query complexity | YES |
| PD-03B-07 | Add timeframe to snapshot identity? | B: Single timeframe V1 | P6-03B §5.2 identity definition; V1 scope is DAILY only; multi-timeframe adds complexity | A: Include timeframe in identity | None | NON-BLOCKING | SUFFICIENT | IS-03, IS-04 | Low — DAILY only in V1; schema can be extended later | YES |

### 2.2 Implicit Decisions (discovered during inventory)

| ID | Question | Proposed Default | Evidence | Alternatives | Dependency | Blocking | Evidence Sufficiency | Affected Invariants | Implementation Impact | Required Before P6-03D |
|---|---|---|---|---|---|---|---|---|---|---|
| PD-03B-08 | Snapshot version tuple: standalone or reuse P6-02 version? | A: Standalone snapshot version tuple | P6-03B §10.2 IS-14 requires SEPARATE version from features; snapshot algorithm differs from feature algorithm | B: Reuse feature version tuple | PD-03B-01 | NON-BLOCKING | SUFFICIENT | IS-13, IS-14 | Low — additional version record per snapshot | YES |
| PD-03B-09 | Snapshot persistence location: synchronous in refresh or async post-refresh? | A: Synchronous within refresh (after feature computation) | P6-01E PD-E1 established quality-before-write pattern; consistency with feature persistence | B: Async background; C: Separate endpoint | PD-03B-05 | NON-BLOCKING | SUFFICIENT | IS-15, IS-18 | Medium — affects refresh duration and error handling | YES |
| PD-03B-10 | Coin snapshot scoring: pass-through feature health_score or recompute? | A: Pass-through (use feature health_score directly) | P6-02B §9.3 health_score is deterministic; IS-15 requires determinism; no need to recompute | B: Recompute from dimensions; C: Hybrid | PD-03B-01 | NON-BLOCKING | SUFFICIENT | IS-15 | Low — pass-through is simpler and deterministic | YES |
| PD-03B-11 | Narrative snapshot input: coin snapshots or live feature reads? | A: Read from persisted coin snapshots | IS-16 requires no live DB dependency; IS-23 requires snapshot independence; coin snapshots are already persisted | B: Live feature reads; C: Both | PD-03B-02, PD-03B-05 | NON-BLOCKING | SUFFICIENT | IS-16 | Medium — requires coin snapshots to exist before narrative snapshots | YES |
| PD-03B-12 | Missing feature data handling: skip snapshot or persist with metadata? | A: Persist with metadata (data_completeness reflects missingness) | P6-02B §4.5 existing behavior; IS-24 (§12.4) suggests absence recording; P4/P5 already handle missing data | B: Skip snapshot entirely | PD-03B-01 | NON-BLOCKING | SUFFICIENT | IS-18 | Low — consistent with existing feature behavior | YES |
| PD-03B-13 | Snapshot retention policy: keep all or expire old? | A: Keep all (V1); no expiration | IS-18 retains SUPERSEDED snapshots; P5 historical replay may need old snapshots; storage cost acceptable for V1 | B: Expire after N days; C: Configurable | PD-03B-05 | NON-BLOCKING | SUFFICIENT | IS-18, IS-22 | Low — no expiration logic needed in V1 | NO (defer to V2) |
| PD-03B-14 | Narrative membership source: live coin_narratives or membership snapshot? | A: Live coin_narratives (current membership) | P6-03A identified narrative_membership_snapshots for historical; V1 uses current membership | B: Historical membership snapshot | PD-03B-02 | NON-BLOCKING | SUFFICIENT | IS-05 | Low — current membership is simpler; historical can be added later | YES |

---

## 3. Dependency Graph

```
PD-03B-05 (table design) ──────────┐
                                    │
PD-03B-03 (granularity) ───────────┤
                                    │
PD-03B-08 (version tuple) ─────────┼──→ PD-03B-09 (persistence location)
                                    │         │
PD-03B-01 (freshness weighting) ───┤         │
                                    │         │
PD-03B-10 (coin score source) ─────┤         │
                                    │         │
PD-03B-02 (narrative V1) ──────────┤         │
  │                                 │         │
  ├→ PD-03B-04 (agg method) ───────┤         │
  │                                 │         │
  └→ PD-03B-14 (membership) ───────┤         │
                                    │         │
PD-03B-11 (narrative input) ───────┤         │
                                    │         │
PD-03B-06 (provenance scope) ──────┤         │
                                    │         │
PD-03B-07 (timeframe identity) ────┤         │
                                    │         │
PD-03B-12 (missing data) ──────────┘         │
                                              │
PD-03B-13 (retention) ── (DEFERRED, no dependency) ┘
```

### 3.1 Recommended Decision Order

| Phase | Decisions | Rationale |
|---|---|---|
| **Phase 1: Foundation** | PD-03B-05, PD-03B-03, PD-03B-08 | Schema design + granularity + versioning form the base |
| **Phase 2: Coin-Level** | PD-03B-01, PD-03B-10, PD-03B-06, PD-03B-07, PD-03B-12 | Coin snapshot semantics, all independent of narrative |
| **Phase 3: Narrative-Level** | PD-03B-02, PD-03B-04, PD-03B-14, PD-03B-11 | Narrative depends on coin snapshot infrastructure |
| **Phase 4: Integration** | PD-03B-09 | Persistence location depends on all prior decisions |
| **Deferred** | PD-03B-13 | Retention policy — V2 concern |

---

## 4. High-Risk Area Audit

### 4.1 Freshness Weighting (PD-03B-01)

| Check | Status | Notes |
|---|---|---|
| Does P6-02 default to no STALE weighting? | YES | P6-02B PD-3/PD-6, P6-02D implementation |
| Is snapshot consistent with P6-02 default? | YES | Proposed Option A aligns |
| Does freshness remain orthogonal to quality? | YES | IS-09, IS-10 enforced |
| Risk of inconsistency if default changes? | LOW | Snapshot records feature outputs; freshness is already in feature provenance |

### 4.2 Narrative Health Aggregation (PD-03B-02, PD-03B-04)

| Check | Status | Notes |
|---|---|---|
| Does existing `calculateWeightedNarrativeHealth()` provide evidence? | YES | P6-03A §2.3 identified this function |
| Is market-cap weighting the P6-02 default? | YES | P6-02C2 PD-C3 |
| Does narrative health respect P4/P5 boundary? | YES | Narrative health output is column-compatible with existing `narrative_health` table |
| Risk of breaking P4/P5 consumers? | LOW | P6-03B IS-20, IS-21 enforce compatibility |

### 4.3 Per-Refresh vs Latest-Only (PD-03B-03)

| Check | Status | Notes |
|---|---|---|
| Does IS-18 require latest-only? | YES | Per (entity_type, entity_id, snapshot_type, window_end) |
| Is per-refresh consistent with latest-only? | YES | Each refresh produces one snapshot per entity; latest-only means one CURRENT per entity |
| Does this match P6-02 feature behavior? | YES | P6-02D uses latest-only via conflict update |
| Risk of storage growth? | LOW | SUPERSEDED retained but not queried in hot path |

### 4.4 Snapshot Identity (PD-03B-07)

| Check | Status | Notes |
|---|---|---|
| Is snapshot identity distinct from observation identity? | YES | IS-03 enforced |
| Is `input_window_end` sufficient for V1? | YES | DAILY timeframe only |
| Does single-timeframe V1 limit future extensibility? | NO | Schema can add timeframe column later |
| Risk of identity collision? | NONE | `(entity_type, entity_id, snapshot_type, input_window_end)` is unique per refresh |

### 4.5 New Table vs Existing (PD-03B-05)

| Check | Status | Notes |
|---|---|---|
| Does IS-21 require additive-only? | YES | Existing table schemas must not be modified |
| Does new table provide clean separation? | YES | P6 snapshots are semantically distinct from legacy morning snapshots |
| Does legacy morning_snapshot_* need to continue? | For P4/P5 backward compat | Existing API consumers may read from legacy tables |
| Risk of dual-write complexity? | MEDIUM | If both P6 and legacy snapshots coexist during transition |

### 4.6 Full Provenance / Reconstruction (PD-03B-06)

| Check | Status | Notes |
|---|---|---|
| Does IS-11 require full provenance chain? | YES | snapshot → features → observations |
| Does IS-17 require reconstruction from provenance? | YES | Verification mechanism |
| Storage impact of full provenance? | MEDIUM | JSONB provenance per snapshot; acceptable for V1 |
| Risk of incomplete provenance? | LOW if input records are persisted |

### 4.7 Timeframe Semantics (PD-03B-07)

| Check | Status | Notes |
|---|---|---|
| V1 scope is DAILY only? | YES | P6-03B §14.3 |
| Can schema extend to multi-timeframe later? | YES | Add timeframe column in V2 migration |
| Risk of premature commitment? | NONE — single timeframe V1 is explicitly limited |

### 4.8 Lifecycle CURRENT/SUPERSEDED (PD-03B-03)

| Check | Status | Notes |
|---|---|---|
| Does IS-18 define latest-only semantics? | YES | One CURRENT per entity/type/window_end |
| Does SUPERSEDED retention support P5 replay? | YES | IS-22, IS-23 protect replay boundary |
| Risk of status confusion with QualityState? | NONE — IS-19 explicitly separates lifecycle from quality states |

### 4.9 Deterministic Calculation Timestamp

| Check | Status | Notes |
|---|---|---|
| Is `calculation_time` wall-clock? | YES | P6-03B §11.1 — for provenance only, not deterministic |
| Does this match P6-02 feature behavior? | YES | Feature `calculated_at` is also wall-clock |
| Risk of non-determinism? | NONE — timestamp is metadata, not identity |

### 4.10 Snapshot Persistence vs Recomputation

| Check | Status | Notes |
|---|---|---|
| Does IS-16 prohibit live DB dependency? | YES | All inputs from persisted records |
| Is recomputation from persisted features deterministic? | YES | IS-15 |
| Risk of stale snapshot if features not refreshed? | MEDIUM — snapshot reflects feature state at calculation time, which may not be latest |

### 4.11 Interaction with P6-02 Feature Versions

| Check | Status | Notes |
|---|---|---|
| Does IS-14 require SEPARATE version tuple? | YES | Snapshot version ≠ feature version |
| Does snapshot record feature version consumed? | YES | `input_features[].feature_p6_version_id` |
| Risk of version mismatch? | LOW — snapshot reads persisted features with their version |

### 4.12 Interaction with P5 Historical/Replay Artifacts

| Check | Status | Notes |
|---|---|---|
| Does IS-23 keep P6 snapshots separate from P5 artifacts? | YES | P5-07 reads from its own artifact tables |
| Does IS-22 protect replay semantics? | YES | No modification to P5 artifact paths |
| Risk of accidental P5 coupling? | NONE — P6 snapshots are new artifacts, not P5 artifacts |

---

## 5. Evidence Gap Reconciliation

| Gap ID | From P6-03B | Status | Action |
|---|---|---|---|
| E-1 | Whether STALE weighting is needed in V1 | SUFFICIENT for V1 default (no weighting) | PD-03B-01 proposed default is safe; can be overridden in V2 |
| E-2 | Narrative membership count and distribution | SUFFICIENT for V1 scope | PD-03B-14 uses current membership; distribution affects performance, not correctness |
| E-3 | Production refresh frequency and snapshot volume | NOT YET AVAILABLE | PD-03B-03 default (per-refresh, latest-only) is safe; volume monitoring can be added in V2 |
| E-4 | Market-cap data availability for narrative weighting | SUFFICIENT — existing `calculateWeightedNarrativeHealth()` already uses market cap | PD-03B-04 reuses proven logic |
| E-5 | morning_snapshot_headers row count and schema | NOT YET AVAILABLE | PD-03B-05 default (new table) avoids dependency on legacy schema inspection |
| E-6 | Whether multi-timeframe snapshots are needed | SUFFICIENT for V1 scope (DAILY only) | PD-03B-07 explicitly limits to DAILY |

**No evidence gaps block P6-03C2 or P6-03D implementation.** All gaps relate to V2 optimization or production monitoring.

---

## 6. Blocking Analysis

### 6.1 Genuinely Blocking Decisions

**NONE.**

All 14 decisions have safe V1 defaults that can be used for implementation without Planner resolution.

### 6.2 Why Nothing Is Blocking

| Reason | Explanation |
|---|---|
| All defaults align with existing P6-02 behavior | PD-03B-01 follows P6-02 PD-3/PD-6 default |
| Narrative health reuses proven logic | PD-03B-04 reuses `calculateWeightedNarrativeHealth()` |
| New table avoids legacy schema dependency | PD-03B-05 provides clean separation |
| Single timeframe limits complexity | PD-03B-07 explicitly V1-scoped |
| Full provenance is additive storage, not semantic | PD-03B-06 adds JSONB, no semantic conflict |
| P4/P5 boundary is enforced by invariants | IS-20, IS-21, IS-22, IS-23 protect frozen contracts |

### 6.3 What Would Make a Decision Blocking

A decision would be BLOCKING if:

1. No safe default exists (e.g., conflicting requirements with no compromise)
2. The decision affects frozen contract semantics (e.g., P4/P5 boundary)
3. The decision determines schema design that cannot be changed additively
4. Evidence is genuinely insufficient and the default could be wrong

None of these conditions apply to the current decision set.

---

## 7. Readiness Matrix

| Metric | Count |
|---|---|
| **Total decisions** | **14** |
| **Explicit (from P6-03B)** | 7 |
| **Implicit (discovered)** | 7 |
| **Blocking** | **0** |
| **Non-blocking** | **14** |
| **Deferred** | **1** (PD-03B-13 retention policy — V2) |
| **Evidence gaps** | **6** (all non-blocking, none block P6-03C2) |
| **Minimum decisions before P6-03D** | **0** (all have safe defaults) |
| **Decisions requiring Planner acceptance for freeze** | **14** (all, before P6-03-FINAL) |

---

## 8. Consistency Checks

| Check | Status | Evidence |
|---|---|---|
| No new QualityState created | ✅ PASS | IS-08, no quality state in lifecycle |
| Freshness remains orthogonal to quality | ✅ PASS | IS-09, IS-10, PD-03B-01 preserves independence |
| Snapshot identity ≠ observation identity | ✅ PASS | IS-03, §5.3 identity comparison table |
| P6-native inputs only | ✅ PASS | IS-05, §6.4 legacy table exclusion |
| No BUY/SELL semantics | ✅ PASS | IS-02, §4.2 boundary |
| P4/P5 untouched | ✅ PASS | IS-20, §13 backward compatibility |
| P5 replay boundary untouched | ✅ PASS | IS-22, IS-23, §15.3 |
| P6-02 version/provenance semantics not contradicted | ✅ PASS | IS-13, IS-14 respect P6-02B §8 and P6-02E persistence |

---

## 9. Consistency with P6-02 Frozen Contracts

| P6-02 Invariant | P6-03B Status | Notes |
|---|---|---|
| DF-01: Feature identity ≠ observation identity | ✅ PRESERVED | IS-03 adds third identity layer (snapshot) |
| DF-02: Feature input traces to observation | ✅ PRESERVED | IS-11 requires full provenance chain |
| DF-03: QualityState frozen vocabulary | ✅ PRESERVED | IS-06, IS-08 |
| DF-04: Freshness ≠ quality | ✅ PRESERVED | IS-09, IS-10 |
| DF-05: Legacy sourceProvenance readable | ✅ PRESERVED | IS-21 additive-only |
| DF-11: Schema additive-only | ✅ PRESERVED | IS-21 |
| DF-12: No BUY/SELL semantics | ✅ PRESERVED | IS-02 |

---

## 10. Files Changed

| File | Content |
|---|---|
| `docs/P6_Upgrade/P6-03C1_SNAPSHOT_DECISION_INVENTORY.md` | This document |

---

## 11. Recommendation

All 14 decisions have safe V1 defaults. No decisions block P6-03C2 or P6-03D implementation. The inventory is ready for Planner review and P6-03C2 (Planner Decision Contract) creation.

---

## 12. Acceptance Checklist

- [x] All P6-03B decisions inventoried (PD-03B-01…07)
- [x] Implicit decisions discovered (PD-03B-08…14)
- [x] Dependency graph built
- [x] Decision order recommended
- [x] All high-risk areas audited (§4)
- [x] Evidence gaps reconciled (§5)
- [x] Blocking analysis complete (§6)
- [x] Readiness matrix produced (§7)
- [x] Consistency checks passed (§8)
- [x] P6-02 invariant compatibility verified (§9)
- [x] No production code modified
- [x] No schema/migration changes
- [x] No P4/P5 changes
- [x] No P6-01/02 changes
- [x] No decisions frozen by agent
