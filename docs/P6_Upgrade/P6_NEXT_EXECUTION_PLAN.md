# P6 — Next Execution Plan

**Date:** 2026-08-26
**Prerequisite:** P6-01E Frozen (`bc0be6f` → freeze declaration this session).
**Next milestone:** P6-02 — Narrative Health Engine.
**Authority:** P6 Master Execution Plan (`P6_00_EXECUTION_PLAN.md`), P6 Master Specification.

---

## 1. Change Control Rule (Preserved)

> A frozen P6 contract cannot be modified implicitly by a downstream implementation task.

If a downstream task discovers that a frozen P6-01B/C/D/E contract must change:
1. STOP implementation.
2. Record the conflict.
3. Open a dedicated change-control task.
4. Re-audit affected invariants.
5. Obtain Planner approval.
6. Only then modify the frozen contract.

---

## 2. P4/P5/P6 Boundary (Preserved)

```text
P3 → Observation (What is happening?)
P4 → Interpretation (What does it mean?)
P5 → Decision Support (What should be done?)
P6 → Observation Intelligence (Canonical observation, ingestion quality, observation identity)
```

No P6 task may introduce:
- BUY/SELL semantics
- Execution permission
- Action policy
- Risk-management policy
- P5 decision semantics
- Hidden trading thresholds

unless explicitly authorized by the P6 Master Specification.

---

## 3. Correct Next Milestone

# P6-02 — Narrative Health Engine

### Why this is the correct next milestone

1. **P6-01 is complete.** All sub-tasks (A through E) are frozen. P6-01-FINAL (phase-level audit) is a documentation gate, not a semantic dependency for P6-02.
2. **P6-02 is the first intelligence capability** in the P6 roadmap. It depends on P6-01-FINAL, which can be executed as a lightweight documentation task at the start of P6-02.
3. **P6-02 and P6-03 may be parallelized** per the original plan ("After P6-01 freezes, P6-02 and P6-03 may be parallelized if their contracts do not conflict"). Shared dimension definitions (P6-02B) are a coordination point.
4. **No blocking dependency exists.** The OI-01…OI-08 items are all deferred product decisions that do not block P6-02 from beginning its recon and contract phases.
5. **The original roadmap is clear.** P6-02A → P6-02-FINAL is the defined execution path.

---

## 4. Agent Delegation Design

| Task | Agent Role | Parallel? | Depends On | Expected Deliverable |
|---|---|---|---|---|
| P6-01-FINAL | Audit Agent | NO (prerequisite) | P6-01E Freeze | Phase-level audit + freeze document |
| P6-02A | Recon Agent | YES (after P6-01-FINAL) | P6-01-FINAL | Metric contract recon document |
| P6-02B | Planner Agent | NO | P6-02A | Health dimension definitions document |
| P6-02C | Planner Agent | NO | P6-02B | Aggregation/composite contract document |
| P6-02D | Implementation Agent | NO | P6-02B | Algorithm V1 implementation |
| P6-02E | Implementation Agent | NO | P6-02D | Snapshot persistence implementation |
| P6-02F | Verification Agent | NO | P6-02D + P6-02E | Test suite + regression |
| P6-02-FINAL | Audit Agent | NO | P6-02F | Freeze audit + recommendation |
| P6-03A | Recon Agent | YES (after P6-01-FINAL) | P6-01-FINAL | Membership/weighting recon document |
| P6-03B | Planner Agent | NO | P6-03A + P6-02B | Coin health contract document |
| P6-03C | Implementation Agent | NO | P6-03B | Breadth/participation implementation |
| P6-03D | Implementation Agent | NO | P6-03C | Coin snapshot persistence |
| P6-03E | Verification Agent | NO | P6-03C + P6-03D | Tests + regression |
| P6-03-FINAL | Audit Agent | NO | P6-03E | Freeze audit + recommendation |

**Parallelization note:** P6-02A and P6-03A may run in parallel after P6-01-FINAL. P6-02B (dimension definitions) is a coordination point for P6-03B (coin health depends on shared dimensions).

---

## 5. Detailed Task Specifications

### P6-01-FINAL — Phase-Level Audit

**Objective:** Produce a unified phase-level audit of P6-01 covering all sub-tasks (A through E).

**Scope:**
- `docs/P6_Upgrade/P6-01*` (all P6-01 documentation)
- `src/lib/p6/` (all P6 implementation)
- `src/db/schema.ts` (P6 tables)
- `drizzle/migrations/*quality*` (quality migration)

**Non-scope:** P6-02+ implementation; P4/P5 changes.

**Implementation steps:**
1. Read all P6-01 freeze documents (A through E-FINAL).
2. Verify each sub-task's frozen state is consistent.
3. Cross-check that no frozen invariant was violated by a later sub-task.
4. Verify P6-01B/C/D/E invariants are all preserved.
5. Verify P4/P5 boundary intact.
6. Run full P6 regression.
7. Produce phase-level audit document.

**Tests:** P4+P5+P6 full regression. Typecheck.

**Acceptance gates:** All sub-tasks frozen. No blocking issues. Regression green.

**Documentation:** `docs/P6_Upgrade/P6-01-FINAL_PHASE_AUDIT.md`

**Freeze gate:** Planner accepts phase-level audit → P6-01 = FROZEN (phase level).

---

### P6-02A — Metric Contract Recon

**Objective:** Inventory available canonical observations against the six required health dimensions.

**Scope:**
- `src/lib/p6/` (quality + freshness + registry)
- `src/app/api/refresh/route.ts` (ingestion path)
- `src/lib/features/engine.ts` (existing feature calculations)
- `src/db/schema.ts` (features, health_scores, market_price_daily, coin_metrics)

**Non-scope:** Algorithm design; implementation changes.

**Implementation steps:**
1. Inventory all V1 metrics currently available in production ingestion (QUALITY, FRESHNESS, existing features).
2. Map each metric against the six health dimensions: momentum, breadth, relative strength, participation, stability, persistence.
3. Identify which dimensions have sufficient data and which have gaps.
4. Document current feature-engine outputs and their relationship to health dimensions.
5. Identify any metrics needed by health dimensions that are not yet available.

**Documentation:** `docs/P6_Upgrade/P6-02A_METRIC_CONTRACT_RECON.md`

**Acceptance gates:** Complete metric×dimension matrix. Gaps identified. No implementation changes.

---

### P6-02B — Health Dimension Definitions

**Objective:** Freeze precise definitions for each of the six health dimensions.

**Scope:** `docs/P6_Upgrade/` (contract documents only).

**Non-scope:** Implementation; algorithm code.

**Implementation steps:**
1. Define each dimension: momentum, breadth, relative strength, participation, stability, persistence.
2. For each: inputs, window, benchmark, missing-data behavior, output semantics.
3. Define how dimensions compose into narrative health.
4. Resolve any ambiguities as Planner decisions (PD-2x series).
5. Produce frozen contract.

**Documentation:** `docs/P6_Upgrade/P6-02B_HEALTH_DIMENSION_CONTRACT.md`

**Freeze gate:** All dimension definitions frozen. No hidden score.

---

### P6-02C — Aggregation / Composite Contract

**Objective:** Define how component dimensions form the decomposable V1 narrative state.

**Scope:** `docs/P6_Upgrade/` (contract documents only).

**Dependencies:** P6-02B (dimension definitions).

**Implementation steps:**
1. Define aggregation method (weighted sum, worst-case, etc.).
2. Define decomposition: composite output must decompose into dimensions.
3. Define confidence propagation.
4. Define missing-data behavior at composite level.

**Documentation:** `docs/P6_Upgrade/P6-02C_AGGREGATION_COMPOSITE_CONTRACT.md`

---

### P6-02D — Algorithm V1 + Parameters

**Objective:** Implement the narrative health algorithm V1.

**Scope:**
- `src/lib/p6/` (new health engine module)
- `src/lib/p6/health/` (proposed)

**Non-scope:** P4/P5 changes; UI; historical backfill.

**Dependencies:** P6-02B + P6-02C (frozen contracts).

**Implementation steps:**
1. Implement per-dimension calculation functions.
2. Implement aggregation/composite function.
3. Implement `algorithmVersion` and parameter versioning.
4. All numeric thresholds as explicit configuration (not code literals).
5. No trading semantics.

**Tests:** Per-dimension unit tests. Composite determinism tests. Edge case coverage.

**Documentation:** `docs/P6_Upgrade/P6-02D_ALGORITHM_V1.md` (parameter/version documentation).

---

### P6-02E — Snapshot Persistence

**Objective:** Persist deterministic narrative health snapshots.

**Scope:**
- `src/db/schema.ts` (new table if needed)
- `src/lib/p6/health/` (persistence layer)

**Dependencies:** P6-02D (algorithm implementation).

**Implementation steps:**
1. Design snapshot schema (narrative_id, date, version, dimension_scores, composite, confidence, provenance).
2. Implement persistence service.
3. Wire into refresh pipeline (after quality evaluation).

**Documentation:** `docs/P6_Upgrade/P6-02E_SNAPSHOT_PERSISTENCE.md`

---

### P6-02F — Tests / Regression

**Objective:** Full test coverage for narrative health engine.

**Scope:** `src/lib/p6/health/__tests__/`

**Dependencies:** P6-02D + P6-02E.

**Tests:** Edge cases (insufficient data, degraded data, component decomposition, reproducibility).

---

### P6-02-FINAL — Audit + Freeze

**Objective:** Freeze narrative health engine.

**Scope:** All P6-02 documentation + implementation.

**Dependencies:** P6-02F.

**Documentation:** `docs/P6_Upgrade/P6-02-FINAL_HEALTH_ENGINE_FREEZE.md`

---

## 6. P6-03 Parallel Track

P6-03 (Coin Health & Narrative Participation) may begin recon (P6-03A) in parallel with P6-02A after P6-01-FINAL. P6-03B (coin health contract) depends on P6-02B (shared dimension definitions).

### P6-03A — Membership / Weighting Recon
**Objective:** Audit current narrative membership and weighting models.

### P6-03B — Coin Health Contract
**Objective:** Freeze coin-level dimensions, narrative-relative behavior, missing-data semantics.
**Dependency:** P6-03A + P6-02B (shared dimensions).

### P6-03C — Breadth / Participation Contribution
**Objective:** Implement explainable contribution metrics.

### P6-03D — Coin Snapshot
**Objective:** Persist deterministic coin health snapshots.

### P6-03E — Tests / Regression
**Objective:** Cover leaders, laggards, improving/deteriorating participants, sparse membership.

### P6-03-FINAL — Audit + Freeze
**Objective:** Freeze coin health and participation semantics.

---

## 7. Acceptance / Freeze Gates (Next Milestone)

### P6-01-FINAL Gate
- [ ] All P6-01 sub-tasks frozen
- [ ] No cross-task invariant violation
- [ ] P4/P5 regression green
- [ ] Typecheck clean
- [ ] Phase-level audit document committed

### P6-02 Gate (each sub-task)
- [ ] Recon complete (for recon tasks)
- [ ] Affected files identified
- [ ] Approved contract followed
- [ ] No unapproved semantic change
- [ ] Targeted tests pass
- [ ] Relevant regression passes
- [ ] Typecheck/build pass
- [ ] Provenance preserved
- [ ] Data-quality behavior explicit
- [ ] Versioning requirements implemented
- [ ] Documentation matches implementation
- [ ] No forbidden trading semantics
- [ ] Agent report identifies all provisional/open items
- [ ] Git boundary clean

### P6-02-FINAL Gate
- [ ] All P6-02 sub-tasks frozen
- [ ] Health dimensions decomposable
- [ ] No hidden score
- [ ] P4/P5 regression green
- [ ] P6-01 frozen invariants preserved

---

## 8. Regression Requirements

| Suite | Required For |
|---|---|
| P6 (all suites) | Every P6 task |
| P5 (all suites) | Every P6 task that touches shared data models |
| P4 (all suites) | Every P6 task that touches features/health/recommendations |
| TypeScript (`tsc --noEmit`) | Every P6 task |

Expected current baseline:
- P6: 288+ tests (678 total with P4+P5)
- Typecheck: PASS

---

## 9. Files Created / Updated

| Document | Purpose | Created |
|---|---|---|
| `docs/P6_Upgrade/P6-01E_FREEZE_DECLARATION.md` | Formal P6-01E freeze | This session |
| `docs/P6_Upgrade/P6_CURRENT_STATE_ASSESSMENT.md` | Complete P6 status assessment | This session |
| `docs/P6_Upgrade/P6_NEXT_EXECUTION_PLAN.md` | This document | This session |
