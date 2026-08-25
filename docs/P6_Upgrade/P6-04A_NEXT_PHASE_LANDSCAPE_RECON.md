# P6-04A — Next Phase Landscape Recon

**Date:** 2026-08-26
**Task Type:** RECON-ONLY — no implementation, no semantic changes
**Baseline:** P6-01 frozen, P6-02 frozen (READY FOR PLANNER FREEZE), P6-03 frozen (READY FOR PLANNER FREEZE)
**Authority:** P6 Master Specification, P6-01/02/03 contracts and audits
**Git boundary:** ONLY this document

---

## 1. Executive Summary

P6-01 (Observation/Quality/Ingestion), P6-02 (Derived Features), and P6-03 (Intelligence Snapshot) are all READY FOR PLANNER FREEZE. The next phase in the P6 roadmap is P6-04 (Trend/Regime Detection).

**Key finding:** P6-04 is the correct next phase. It has no blocking dependencies on unfrozen work. All 8 OI items (OI-01…OI-08) remain intentionally deferred and do not block P6-04 from beginning recon.

**Recommended next task:** P6-04A — Trend/Regime Detection Landscape Recon.

---

## 2. Current Pipeline State

```
P3: Raw Data Collection
  ↓ (market_price_daily, coin_metrics, indicators)
P6-01: Canonical Observations + Quality + Freshness + Ingestion [FROZEN]
  ↓ (p6_observation tables, quality evaluation, freshness tracking)
P6-02: Derived Features + Aggregation [READY FOR PLANNER FREEZE]
  ↓ (p6_feature engine, health scores, confidence)
P6-03: Intelligence Snapshots [READY FOR PLANNER FREEZE]
  ↓ (p6_snapshots, coin/narrative health)
P4: Interpretation [FROZEN]
  ↓ (feature → health score → recommendation)
P5: Decision Support [FROZEN]
  ↓ (rule engine → signal → action)
```

### 2.1 What's Frozen

| Phase | Status | Key Output |
|---|---|---|
| P6-01A-E | FROZEN | Canonical observation identity, quality, freshness, ingestion |
| P6-02A-F | READY FOR PLANNER FREEZE | Derived feature engine, aggregation, confidence |
| P6-03A-F | READY FOR PLANNER FREEZE | Intelligence snapshots, coin/narrative health |
| P4 | FROZEN | Interpretation engine |
| P5 | FROZEN | Decision support, rule engine, replay |

### 2.2 What's NOT Started

| Phase | Status | Dependency |
|---|---|---|
| P6-04 | NOT STARTED | P6-02 + P6-03 (both ready) |
| P6-05 | NOT STARTED | P6-02 + P6-03 + P6-04 |
| P6-06 | NOT STARTED | P6-05 |
| P6-07 | NOT STARTED | P6-06 |
| P6-08 | NOT STARTED | P6-06 |
| P6-09 | NOT STARTED | P6-07 + P6-08 |
| P6-FINAL | NOT STARTED | P6-09 |

---

## 3. Remaining Legacy Dependencies

### 3.1 P6 Modules — Clean

No `market_price_daily`, `coin_metrics`, `indicators`, or `morning_snapshots` imports in any `src/lib/p6/` file.

### 3.2 Refresh Route — Hybrid

The refresh route (`src/app/api/refresh/route.ts`) still uses legacy tables for:
- Data collection (`market_priceDaily` for price data)
- Feature computation (`runFeatureEngine` reads from legacy `market_price_daily`)
- Health scores (saved to `healthScores` table)
- Recommendations (saved to `recommendations` table)
- Morning snapshots (`snapshotService.createDailySnapshot`)

**Assessment:** This is expected. P6-01/02/03 are ADDITIVE layers. The legacy P4/P5 pipeline remains functional. P6 snapshots are generated alongside legacy outputs, not replacing them.

### 3.3 P6-02 Feature Engine — Parallel

P6-02 introduced a new P6-native feature engine (`src/lib/p6/feature/`) that reads from P6 canonical observations. However, the refresh route still uses the legacy `runFeatureEngine()` for P4/P5 compatibility. The P6 feature engine runs in parallel via `runSnapshotGeneration()`.

**Gap:** The P6-02 feature engine is not yet the primary feature computation path. The legacy engine remains the production path. This is by design (PD-03B-10: pass-through from legacy features) but should be addressed in a future phase.

---

## 4. Deferred Items Audit

### 4.1 OI-01…OI-08

| ID | Item | Current State | Resolution Phase | Blocking P6-04? |
|---|---|---|---|---|
| OI-01 | FR range bound | No range validation | P6-02+ when needed | NO |
| OI-02 | Temporal tolerance | No temporal checks | P6-04 (trend may need it) | NO |
| OI-03 | Dedup remediation | Detection only (latest-only) | Product decision if needed | NO |
| OI-04 | Cross-source comparator | No cross-source priority | P6-02+ when needed | NO |
| OI-05 | Historical retention | Latest-only V1 | P6-08 | NO |
| OI-06 | Feature gating | Not in P6-02 scope | P6-02 (partially done) | NO |
| OI-07 | Signal unification | Untouched | P6-06 | NO |
| OI-08 | Mixed aggregation | Outside D2 scope | P6-02 (partially done) | NO |

**Assessment:** All 8 items are intentionally deferred. None blocks P6-04.

### 4.2 STALE Weighting (PD-03B-01, PD-3, PD-6)

- **Current:** No freshness weighting in V1 (snapshots computed from all features regardless of freshness)
- **Resolution:** Deferred to P6-02E+ or when production observation shows stale data impact
- **Blocking P6-04?** NO — P6-04 trend detection can work without freshness weighting

### 4.3 Source Priority (PD-03B-06b, PD-6b)

- **Current:** No source priority V1 (all sources treated equally)
- **Resolution:** Deferred to P6-02E+
- **Blocking P6-04?** NO

### 4.4 Narrative Health V2 Items

- **Current:** Market-cap weighted aggregation (PD-03B-04)
- **V2 items:** Configurable weighting, membership history, narrative comparison
- **Resolution:** P6-06 (intelligence aggregation) or later
- **Blocking P6-04?** NO

### 4.5 Snapshot Retention (PD-03B-13)

- **Current:** Keep all snapshots V1, no expiration
- **Resolution:** Deferred to V2 (P6-08 historical/backfill)
- **Blocking P6-04?** NO

### 4.6 P6-02 Feature Engine Primary Path

- **Current:** Legacy `runFeatureEngine()` remains production path; P6-02 engine runs in parallel
- **Resolution:** Should be addressed when P6-02 is frozen (PD-7 pipeline strategy)
- **Blocking P6-04?** NO — P6-04 reads from snapshots, not directly from feature engine

---

## 5. Capability Gap Analysis

### 5.1 REQUIRED FOR P6 COMPLETION

| Gap | Phase | Why Required |
|---|---|---|
| P6-02 freeze (Planner acceptance) | P6-02 | Must be frozen before P6-04 begins |
| P6-03 freeze (Planner acceptance) | P6-03 | Must be frozen before P6-04 begins |
| P6-04 Trend/Regime Detection | P6-04 | Core intelligence capability |
| P6-05 Early Warning Engine | P6-05 | Material change detection |
| P6-06 Intelligence Aggregation | P6-06 | Coherent intelligence view |
| P6-07 UI/Dashboard | P6-07 | User-facing intelligence |
| P6-08 Historical/Backfill | P6-08 | Historical intelligence |
| P6-09 System Verification | P6-09 | Final verification |
| P6-FINAL Baseline Freeze | P6-FINAL | Formal freeze |

### 5.2 IMPORTANT BUT DEFERABLE

| Gap | Phase | Why Important |
|---|---|---|
| P6-02 primary feature path | P6-02F+ | Legacy engine should be replaced |
| OI-01 FR range bound | P6-02+ | Product decision needed |
| OI-02 Temporal tolerance | P6-04 | Trend detection may need it |
| OI-04 Cross-source comparator | P6-02+ | Product decision needed |
| STALE weighting | P6-02E+ | Production observation needed |
| Source priority | P6-02E+ | Product decision needed |

### 5.3 FUTURE/V2

| Gap | Phase | Why Future |
|---|---|---|
| OI-05 Historical retention | P6-08 | Requires storage design |
| OI-07 Signal unification | P6-06 | Requires product decision |
| Snapshot retention policy | P6-08 | Operational concern |
| Narrative membership history | P6-06+ | Time-travel analysis |
| Multi-timeframe snapshots | P6-04+ | If product requires |
| Cross-coin metrics | P6-06+ | Breadth, participation, relative_strength |

### 5.4 NOT NEEDED

| Gap | Why Not Needed |
|---|---|
| P4/P5 modification | Frozen, working correctly |
| P6-01 contract modification | Frozen, invariant-safe |
| Legacy table replacement | Additive P6 layer is sufficient |
| New QualityState values | Frozen vocabulary is complete |

---

## 6. Dependency Graph

```
P6-01 (FROZEN)
  ↓
P6-02 (READY FOR PLANNER FREEZE) ──┐
                                    ├──> P6-04 (Trend/Regime)
P6-03 (READY FOR PLANNER FREEZE) ──┘         ↓
                                        P6-05 (Early Warning)
                                              ↓
                                        P6-06 (Intelligence Aggregation)
                                              ↓
                                    ┌─────────┴─────────┐
                                    ↓                   ↓
                              P6-07 (UI)          P6-08 (Historical)
                                    ↓                   ↓
                                    └─────────┬─────────┘
                                              ↓
                                        P6-09 (Verification)
                                              ↓
                                        P6-FINAL (Baseline Freeze)
```

### 6.1 Critical Path

```
P6-02 Freeze → P6-03 Freeze → P6-04A Recon → P6-04 Implementation → P6-04 Freeze
```

### 6.2 Parallelization Opportunities

- P6-02 and P6-03 can be frozen in parallel (no semantic conflicts)
- P6-04A can begin after P6-02/03 freeze declarations
- P6-07 (UI) and P6-08 (Historical) can run in parallel after P6-06

---

## 7. P6-04 Next Phase Proposal

### 7.1 Scope

**P6-04 — Trend / Regime Detection**

Detect transitions and acceleration/deceleration in coin and narrative health.

### 7.2 Objective

Build a state machine that:
- Monitors health score changes over time
- Detects regime transitions (improving → stable → declining)
- Identifies acceleration/deceleration patterns
- Persists trend state with full provenance
- Generates early signals for narrative/coin health changes

### 7.3 Boundaries

**In scope:**
- State machine for health regime detection
- Transition rules and thresholds
- Trend persistence (p6_trend_states or similar)
- Provenance chain from snapshots
- Tests and freeze report

**Out of scope:**
- Early warning engine (P6-05)
- Intelligence aggregation (P6-06)
- UI/Dashboard (P6-07)
- Historical backfill (P6-08)
- BUY/SELL/action semantics (NEVER)
- P4/P5 modifications (FROZEN)

### 7.4 Blocking Decisions

| Decision | Question | Resolution Phase |
|---|---|---|
| PD-04-01 | What constitutes a "regime"? (thresholds, timeframes) | P6-04B |
| PD-04-02 | State machine model (finite states, transitions) | P6-04B |
| PD-04-03 | Trend sensitivity (how many data points to detect change) | P6-04B |
| PD-04-04 | Regime persistence (latest-only vs historical) | P6-04B |
| PD-04-05 | Coin vs narrative trend (same model or different?) | P6-04B |

### 7.5 Implementation Candidates

| Component | Approach | Complexity |
|---|---|---|
| State machine | Enum-based (IMPROVING, STABLE, DECLINING, UNKNOWN) | Medium |
| Transition rules | Threshold-based (score delta, time window) | Medium |
| Persistence | New `p6_trend_states` table (additive) | Low |
| Provenance | Reference snapshot IDs + version tuples | Low |
| Tests | Unit + integration | Medium |

### 7.6 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Threshold sensitivity | Medium | Defer thresholds to Planner decision |
| State machine complexity | Low | Start simple, extend in V2 |
| Historical comparison needs | Medium | P6-08 handles historical; P6-04 is latest-only V1 |
| OI-02 temporal tolerance | Low | May be needed for trend detection; resolve in P6-04B |

---

## 8. Recommended Execution Graph

```
P6-04A  — Trend/Regime Landscape Recon
P6-04B  — Trend/Regime Semantic Contract
P6-04C  — Trend/Regime Decision Inventory
P6-04C2 — Trend/Regime Planner Decision Contract
P6-04D  — Trend/Regime Implementation
P6-04E  — Trend/Regime Hardening + Persistence
P6-04F  — Trend/Regime Freeze Audit
P6-04-FINAL — Phase-Level Audit
```

---

## 9. Acceptance Checklist

- [x] Pipeline state assessed (P6-01/02/03 frozen, P6-04+ not started)
- [x] Legacy dependencies identified (refresh route hybrid, P6 modules clean)
- [x] Capability gaps classified (REQUIRED / DEFERABLE / FUTURE / NOT NEEDED)
- [x] OI-01…OI-08 audited (all deferred, none blocking)
- [x] Deferred items documented (STALE weighting, source priority, retention, etc.)
- [x] Dependency graph created
- [x] P6-04 proposal defined (scope, objective, boundaries, decisions, candidates, risks)
- [x] No implementation, no semantic changes, no frozen contract modifications
