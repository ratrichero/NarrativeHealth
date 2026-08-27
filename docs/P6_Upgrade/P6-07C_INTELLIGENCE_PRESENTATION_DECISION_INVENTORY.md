# P6-07C — Intelligence Presentation Decision Inventory & Gap Audit

**Date:** 2026-08-27
**Phase:** P6-07 Intelligence Presentation
**Status:** DECISION INVENTORY COMPLETE
**Previous:** P6-07B semantic contract (`1c28ed0`)

---

## 1. Executive Summary

P6-07C performs a focused decision inventory and semantic gap audit for the P6-07 Intelligence Presentation Layer. This task challenges every P6-07B decision, discovers hidden implicit decisions, and validates the proposed architecture against the actual repository.

**Key findings:**

- 3 blocking decisions confirmed (all genuinely blocking)
- 1 decision reclassified: PD-07B-08 (optional refresh) → **OPEN, not blocking** — safe default exists
- 5 new implicit decisions discovered
- All 18 proposed invariants validated, 2 new invariants added
- Read API architecture validated
- Refresh wiring architecture validated
- Legacy retirement validated
- No P4/P5 boundary violations

**Total decisions: 21** | **Blocking: 3** | **Non-blocking: 15** | **Deferred: 3**

**Verdict: READY FOR P6-07C1**

---

## 2. P6-07B Contract Reconciliation

| P6-07B Decision | Status | P6-07C Audit Result |
|---|---|---|
| PD-07A-01 (Refresh wiring) | BLOCKING | ✅ Confirmed genuinely blocking |
| PD-07A-02 (Read API design) | BLOCKING | ✅ Confirmed genuinely blocking |
| PD-07A-03 (Legacy retirement) | BLOCKING | ✅ Confirmed genuinely blocking |
| PD-07B-01 (Read DTOs) | NON-BLOCKING | ✅ Safe default sufficient |
| PD-07B-02 (Symmetric DTOs) | NON-BLOCKING | ✅ Safe default sufficient |
| PD-07B-03 (Collapsible tech details) | NON-BLOCKING | ✅ Safe default sufficient |
| PD-07B-04 (Empty state fallback) | NON-BLOCKING | ✅ Safe default sufficient |
| PD-07B-05 (Resolved warnings section) | NON-BLOCKING | ✅ Safe default sufficient |
| PD-07B-06 (Regime animation) | NON-BLOCKING | ✅ Safe default sufficient |
| PD-07B-07 (No P6-07 persistence) | NON-BLOCKING | ✅ Confirmed correct |
| PD-07B-08 (Optional refresh wiring) | **RECLASSIFIED → OPEN** | ⚠️ See §11 |

---

## 3. Decision Inventory Method

| Source | Count |
|---|---|
| Inherited from frozen P6 contracts | 8 |
| P6-07A explicit (carried forward) | 3 |
| P6-07B explicit | 8 |
| **New implicit (PD-07C-01…05)** | **5** |
| **Total** | **21** (8 inherited + 3 carried + 5 new + 5 P6-07B remaining) |

---

## 4. Inherited Decisions

| ID | Source | P6-07 Impact |
|---|---|---|
| PD-06A-01 | P6-06 | Summary scope defined; P6-07 consumes |
| PD-06A-02 | P6-06 | Explanation format defined; P6-07 renders |
| PD-06A-03 | P6-06 | Two-point change detection; P6-07 displays deltas |
| PD-06A-04 | P6-06 | Empty population; P6-07 handles gracefully |
| PD-06C-01 | P6-06 | window_end deterministic; P6-07 displays |
| PD-03B-09 | P6-03 | Snapshot generation synchronous |
| PD-E2 | P6-01 | Never block refresh on snapshot failure |
| PD-05B-06 | P6-05 | Warning lifecycle: DETECTED/ACTIVE/RESOLVED/SUPERSEDED |

---

## 5. P6-07B Decisions

| ID | Question | Proposed | Classification |
|---|---|---|---|
| PD-07B-01 | Presentation model | Read DTOs | NON-BLOCKING |
| PD-07B-02 | Coin/narrative symmetry | Identical DTO shapes | NON-BLOCKING |
| PD-07B-03 | Technical details | Collapsible | NON-BLOCKING |
| PD-07B-04 | Empty state handling | "No P6 data" fallback | NON-BLOCKING |
| PD-07B-05 | Resolved warnings | Separate section | NON-BLOCKING |
| PD-07B-06 | Regime animation | Visual indicator | NON-BLOCKING |
| PD-07B-07 | P6-07 persistence | No new tables | NON-BLOCKING |
| PD-07B-08 | Optional refresh wiring | Configurable | **OPEN** |

---

## 6. New Implicit Decisions

| ID | Question | Proposed | Classification | Dependent On |
|---|---|---|---|---|
| **PD-07C-01** | Should `/api/p6/*` endpoints require authentication? | YES — use existing auth middleware | NON-BLOCKING | PD-07A-02 |
| **PD-07C-02** | Should P6-07 expose a single composite endpoint or separate per-artifact endpoints? | BOTH — composite `/api/p6/[entityType]/[entityId]` + separate `/api/p6/warnings/[entityType]/[entityId]` | NON-BLOCKING | PD-07A-02 |
| **PD-07C-03** | Should P6-07 DTOs include raw P6 artifact IDs for debugging? | YES — include `snapshot_id`, `regime_id`, `summary_id` in meta | NON-BLOCKING | PD-07B-01 |
| **PD-07C-04** | Should refresh wiring run regime+warnings for ALL entities or only changed entities? | ALL — deterministic full pipeline per refresh cycle | NON-BLOCKING | PD-07A-01 |
| **PD-07C-05** | Should P6-07 presentation components be client-side or server-side rendered? | Client-side (existing pattern: `"use client"` + React Query) | NON-BLOCKING | PD-07B-01 |

---

## 7. Blocking Decision Audit

### PD-07A-01 — Refresh Wiring

| Aspect | Assessment |
|---|---|
| **Why blocking** | Without wiring P6-04/05/06 into refresh, the pipeline produces no regime/warning/summary data for any entity. P6-07 presentation has nothing to display. |
| **Ambiguity** | None — the exact insertion point is clear (after P6-03 snapshot in `/api/refresh/route.ts`) |
| **Downstream** | All P6-07 presentation, all read APIs |
| **Proposed resolution sufficient** | YES — wire P6-04→P6-05→P6-06 sequentially after P6-03 |
| **Should remain blocking** | **YES** |

### PD-07A-02 — Read API Design

| Aspect | Assessment |
|---|---|
| **Why blocking** | No HTTP endpoints exist for P6 artifacts. UI cannot consume P6 data without APIs. |
| **Ambiguity** | Minor — exact route structure needs finalization (addressed by PD-07C-02) |
| **Downstream** | All UI components |
| **Proposed resolution sufficient** | YES — `/api/p6/*` endpoints with thin DTOs |
| **Should remain blocking** | **YES** |

### PD-07A-03 — Legacy Panel Retirement

| Aspect | Assessment |
|---|---|
| **Why blocking** | Existing narrative page uses P3/P4/P5 panels. P6-07 must replace them. Without retirement decision, implementation cannot proceed. |
| **Ambiguity** | Minor — can be handled incrementally (see §10) |
| **Downstream** | All UI migration |
| **Proposed resolution sufficient** | YES — retire P3/P4/P5 panels, replace with P6-native |
| **Should remain blocking** | **YES** |

---

## 8. PD-07A-01 Refresh Wiring Audit

### Current State

The refresh pipeline in `/api/refresh/route.ts` currently runs:

```
P6-01 observation → P6-03 snapshot
```

P6-04, P6-05, P6-06 are **NOT wired**.

### Proposed Wiring

```
P6-03 snapshot (existing)
  ↓
P6-04 regime detection (NEW)
  ↓
P6-05 warning detection (NEW)
  ↓
P6-06 aggregation (NEW)
```

### Audit Findings

| Finding | Result |
|---|---|
| Insertion point clear | ✅ After line ~1106 in route.ts |
| P6-04/05 can run independently | ✅ Both consume P6-03 snapshots |
| P6-06 can run with partial input | ✅ PD-06A-04 allows ≥1 input |
| Failure isolation | ✅ PD-E2: never block refresh |
| Idempotency | ✅ Same-window re-evaluation produces same artifacts |
| Concurrency safe | ✅ Same-window upsert semantics |

---

## 9. PD-07A-02 Read API Audit

### Proposed Endpoints

| Endpoint | Source | Status |
|---|---|---|
| `GET /api/p6/[entityType]/[entityId]` | Composite: P6-03+04+05+06 | ✅ VALIDATED |
| `GET /api/p6/warnings/[entityType]/[entityId]` | P6-05 (multiple per entity) | ✅ VALIDATED |
| `GET /api/p6/summaries` | P6-06 (list) | ✅ VALIDATED |

### Read API Gap Audit

| Gap | Impact | Resolution |
|---|---|---|
| No `/api/p6/*` routes exist | UI cannot consume P6 | P6-07D must create them |
| `readCurrentSnapshot` is internal only | Not exposed via HTTP | P6-07D wraps in API route |
| `readCurrentSummary` is internal only | Not exposed via HTTP | P6-07D wraps in API route |
| `readCurrentRegime` is internal only | Not exposed via HTTP | P6-07D wraps in API route |
| `readActiveWarnings` is internal only | Not exposed via HTTP | P6-07D wraps in API route |

---

## 10. PD-07A-03 Legacy Retirement Audit

### Component Classification

| Component | Classification | Evidence |
|---|---|---|
| `P3IntelligencePanel` | **RETIRE** | Consumes P3 legacy data; no P6 integration |
| `P4DecisionSupportPanel` | **RETIRE** | Consumes P4 legacy data; semantic boundary |
| `P5ActionDecisionPanel` | **RETIRE** | Consumes P5 legacy data; action semantics |
| `HealthBadge` | **REUSE** | Presentation-only, no intelligence semantics |
| `ScoreChange` | **REUSE** | Presentation-only, delta display |
| `ConfidenceBadge` | **REUSE** | Presentation-only, confidence display |
| `CoinRankingTable` | **ADAPT** | Needs P6 data source |
| `CorrelationHeatmap` | **DEFER** | Cross-entity, P6-08 scope |
| `HealthTimeline` | **ADAPT** | Needs P6 snapshot data source |
| `NarrativeCard` | **ADAPT** | Needs P6 summary data source |

### Semantic vs UI Separation

| Type | Components |
|---|---|
| **UI component reuse** | HealthBadge, ScoreChange, ConfidenceBadge, SourceStatusBar |
| **Data-source retirement** | P3IntelligencePanel, P4DecisionSupportPanel, P5ActionDecisionPanel |
| **Adaptation needed** | CoinRankingTable, HealthTimeline, NarrativeCard |

### Retirement Decision

Legacy panel retirement is a **semantic blocker** because:

1. The narrative page currently imports P3/P4/P5 panels
2. P6-07 must replace these imports with P6-native components
3. Without the retirement decision, implementation cannot determine which imports to remove

**Should remain blocking: YES**

---

## 11. PD-07B-08 Optional Refresh Audit

### P6-07B Proposal

PD-07B-08 proposed making P6-04/05/06 refresh wiring **optional/configurable**.

### Audit Finding

| Risk | Assessment |
|---|---|
| Stale regime if wiring disabled | YES — regime would never update |
| Stale warnings if wiring disabled | YES — warnings would never update |
| Stale summaries if wiring disabled | YES — summaries would never update |
| Misleading UI | YES — UI would show outdated P6 data |
| Non-deterministic consumer behavior | YES — depends on configuration state |

### Reclassification

**PD-07B-08 is NOT blocking** because:

- The safe default is: wiring is **always enabled** (not optional)
- Making it optional is a future configurability concern, not a V1 requirement
- V1 should wire P6-04/05/06 unconditionally after P6-03

**New classification: OPEN** — V1 wires unconditionally; configurability deferred.

### Downstream Impact

None — this reclassification simplifies V1 implementation.

---

## 12. Read API Gap Audit

| Endpoint | Necessity | Source | Status |
|---|---|---|---|
| `GET /api/p6/[entityType]/[entityId]` | REQUIRED | P6-03+04+05+06 | Must create |
| `GET /api/p6/warnings/[entityType]/[entityId]` | REQUIRED | P6-05 | Must create |
| `GET /api/p6/summaries` | NICE-TO-HAVE | P6-06 | Can defer |
| `GET /api/p6/summaries/[entityType]/[entityId]` | REQUIRED | P6-06 | Must create |

---

## 13. Refresh Pipeline Audit

### Dependency Chain

```
P6-03 Snapshot
  ↓ (independent)
P6-04 Regime ← needs P6-03 snapshots
  ↓ (independent of P6-04)
P6-05 Warning ← needs P6-03 snapshots
  ↓ (needs P6-04 OR P6-05)
P6-06 Summary ← needs at least one of P6-03/04/05
```

### Failure Semantics

| Failure | Impact | Behavior |
|---|---|---|
| P6-03 fails | No P6 data | Skip P6-04→06, log error |
| P6-04 fails | No regime | P6-05 runs, P6-06 uses partial input |
| P6-05 fails | No warnings | P6-04 runs, P6-06 uses partial input |
| P6-06 fails | No summary | UI shows null summary |
| All fail | No P6 data | UI shows "No P6 data" |

---

## 14. Presentation Model Audit

### PD-07B-01 Validation

| Risk | Assessment |
|---|---|
| Business logic in UI | ✅ Prevented by DTO boundary |
| Duplicate intelligence calculations | ✅ Prevented — DTOs are read-only transforms |
| Semantic reinterpretation | ✅ Prevented — DTOs preserve P6 semantics |
| Accidental legacy fallback | ✅ Prevented — P6-07 explicitly replaces legacy |
| Hidden filtering | ✅ Prevented — DTOs pass through all current artifacts |

**Thin Read DTO architecture is sufficient for V1.**

---

## 15. Narrative/Coin Symmetry Audit

### PD-07B-02 Validation

| Property | Coin | Narrative | Symmetric? |
|---|---|---|---|
| Snapshot available | YES | YES | ✅ |
| Regime available | YES | YES | ✅ |
| Warnings available | YES | YES | ✅ |
| Summary available | YES | YES | ✅ |
| QualityState | YES | YES | ✅ |
| FreshnessState | YES | YES | ✅ |
| Member/mover context | NO | YES | ⚠️ Difference |
| Explanation arrays | YES | YES | ✅ |

**Symmetry is mostly correct.** Narrative has additional member/mover context (top-N movers). This is a **contextual addition**, not a semantic asymmetry — the DTO shape is identical, but narrative DTOs may include optional `member_movers` field.

---

## 16. Warning Presentation Audit

| Aspect | P6-05 Frozen | P6-07 Presentation | Preserved? |
|---|---|---|---|
| Occurrence identity | warning_id | Displayed | ✅ |
| Severity | INFO/LOW/MEDIUM/HIGH/CRITICAL | Color badge | ✅ |
| Lifecycle | DETECTED/ACTIVE/RESOLVED/SUPERSEDED | Active + resolved sections | ✅ |
| Ordering | severity DESC → recency DESC → id ASC | Same ordering | ✅ |
| Deduplication | P6-05 handles | No re-dedup in UI | ✅ |
| No new semantics | — | No new warning types | ✅ |

---

## 17. Regime Presentation Audit

| Aspect | P6-04 Frozen | P6-07 Presentation | Preserved? |
|---|---|---|---|
| STRONG/STABLE/WEAK | FROZEN | Text badge | ✅ |
| TRANSITIONING | FROZEN | Animated indicator | ✅ |
| INSUFFICIENT_DATA | FROZEN | "Insufficient data" | ✅ |
| UNKNOWN | FROZEN | "Unknown" | ✅ |
| Null/missing | FROZEN | "No regime data" | ✅ |
| No recalculation | — | UI never recalculates regime | ✅ |

---

## 18. Intelligence Summary Audit

| Aspect | P6-06 Frozen | P6-07 Presentation | Preserved? |
|---|---|---|---|
| CURRENT/SUPERSEDED | FROZEN | CURRENT only | ✅ |
| Identity | FROZEN | Displayed in meta | ✅ |
| window_end | FROZEN | Displayed | ✅ |
| Explanation arrays | FROZEN | Rendered | ✅ |
| Ranking | FROZEN | Same ordering | ✅ |
| Cap (10 items) | FROZEN | Same cap | ✅ |
| No historical comparison | FROZEN | No historical UI | ✅ |

---

## 19. Quality/Freshness Audit

| Check | Result |
|---|---|
| Quality ≠ Freshness | ✅ Independent display |
| Infrastructure failure ≠ data quality | ✅ Not displayed as quality |
| No new QualityState | ✅ No creation |
| No collapse into quality | ✅ Freshness independent |
| Metadata only | ✅ Read-only indicators |

---

## 20. Provenance/Versioning Audit

| Check | Result |
|---|---|
| Provenance preserved | ✅ In collapsed technical details |
| Version displayed | ✅ P6-03/04/05/06 versions shown |
| No fabricated IDs | ✅ Only real artifact IDs |
| No internal metadata leakage | ✅ DTOs expose necessary metadata only |

---

## 21. Error/Empty State Audit

| State | API Response | UI Display |
|---|---|---|
| Entity not found | `success: false` | Error page |
| No P6 data | `success: true, data: null` | "No P6 data" fallback |
| Partial P6 data | `success: true, data: {..., regime: null}` | Show available, hide missing |
| Infrastructure error | `success: false` | "Unable to load" message |

---

## 22. Access/Security Audit

| Check | Result |
|---|---|
| Existing auth middleware | ✅ Sufficient for P6-07 |
| No new auth changes needed | ✅ Confirmed |
| Public/internal distinction | ✅ Uses existing route protection |
| Outside P6-07 scope | ✅ Security not a blocker |

---

## 23. Legacy Component Classification

| Component | Classification | Reason |
|---|---|---|
| P3IntelligencePanel | RETIRE | Legacy P3 data |
| P4DecisionSupportPanel | RETIRE | Legacy P4 data |
| P5ActionDecisionPanel | RETIRE | Legacy P5 data |
| HealthBadge | REUSE | Presentation-only |
| ScoreChange | REUSE | Presentation-only |
| ConfidenceBadge | REUSE | Presentation-only |
| CoinRankingTable | ADAPT | Needs P6 source |
| HealthTimeline | ADAPT | Needs P6 source |
| NarrativeCard | ADAPT | Needs P6 source |
| CorrelationHeatmap | DEFER | P6-08 scope |
| SourceStatusBar | REUSE | Presentation-only |

---

## 24. Proposed Invariant Audit

| ID | Statement | Valid? | Refinement |
|---|---|---|---|
| PV-01 | P6-07 consumes only P6-native artifacts | ✅ | — |
| PV-02 | P6-07 does not recalculate semantics | ✅ | — |
| PV-03 | P6-07 is read-only | ✅ | — |
| PV-04 | P6-07 output is deterministic | ✅ | — |
| PV-05 | Read API identity matches P6 identity | ✅ | — |
| PV-06 | Read APIs return only CURRENT | ✅ | — |
| PV-07 | Empty P6 state returns null | ✅ | — |
| PV-08 | Provenance preserved | ✅ | — |
| PV-09 | Quality/Freshness independent | ✅ | — |
| PV-10 | P4 untouched | ✅ | — |
| PV-11 | P5 untouched | ✅ | — |
| PV-12 | No action semantics | ✅ | — |
| PV-13 | No BUY/SELL semantics | ✅ | — |
| PV-14 | No legacy contamination | ✅ | — |
| PV-15 | Refresh preserves ordering | ✅ | — |
| PV-16 | Partial failure does not block refresh | ✅ | — |
| PV-17 | Infra failure ≠ QualityState | ✅ | — |
| PV-18 | Explanation arrays always present | ✅ | — |

### New Invariants

| ID | Statement | Class |
|---|---|---|
| **PV-19** | P6-07 DTOs are thin transformations, not intelligence engines | Boundary |
| **PV-20** | P6-07 UI never reconstructs regime from health score | Boundary |

**20 total invariants proposed. 0 violations.**

---

## 25. Evidence Gaps

| Gap | Blocking? | Impact |
|---|---|---|
| No `/api/p6/*` routes exist | **YES** | UI cannot consume P6 artifacts |
| P6-04/05 not wired in refresh | **YES** | No regime/warning data produced |
| No P6 summary data in production | No | P6-07 handles empty state |
| Legacy UI hardcoded to legacy sources | No | P6-07 replaces imports |
| P6 read APIs are internal only | No | P6-07 wraps in HTTP routes |

---

## 26. Dependency Graph

```
PD-07A-01 (Refresh wiring) ──────────────────┐
PD-07A-02 (Read APIs) ───────────────────────┤
PD-07A-03 (Legacy retirement) ───────────────┤
                                              ↓
                                    P6-07C1 Planner Contract
                                              ↓
                                    P6-07D Implementation
                                              ↓
                              ┌────────────────┼────────────────┐
                              ↓                ↓                ↓
                        Refresh wiring    Read APIs      UI migration
                              ↓                ↓                ↓
                        P6-04/05/06      /api/p6/*      Narrative/Coin
                        in refresh      endpoints        pages
```

---

## 27. Recommended P6-07D Scope

P6-07D should implement:

1. **Refresh wiring** — P6-04 regime + P6-05 warnings + P6-06 aggregation after P6-03
2. **Read APIs** — `/api/p6/[entityType]/[entityId]` + `/api/p6/warnings/[entityType]/[entityId]`
3. **Read DTOs** — Thin transformation layer
4. **Narrative page update** — Replace P3/P4/P5 panels with P6-native
5. **Coin page update** — Replace legacy data sources with P6
6. **UI contract tests** — Verify no BUY/SELL/action semantics

---

## 28. Recommended Execution Sequence

```
P6-07A  Landscape Recon ← COMPLETE
  ↓
P6-07B  Semantic Contract ← COMPLETE
  ↓
P6-07C  Decision Inventory ← YOU ARE HERE
  ↓
P6-07C1 Focused Planner Decision Contract
  ↓
Planner Acceptance
  ↓
P6-07D  Implementation
  ↓
P6-07E  Hardening + Freeze Audit
  ↓
P6-07-FINAL Freeze Declaration
```

---

## 29. Readiness Verdict

```
READY FOR P6-07C1
```

3 blocking decisions confirmed (all genuinely blocking). 5 new implicit decisions discovered (all non-blocking). PD-07B-08 reclassified from blocking to OPEN. 20 invariants proposed. All evidence gaps are non-blocking except the two core gaps (no APIs, no refresh wiring) which are resolved by the 3 blocking decisions.

---

## 30. Git Boundary

| Check | Result |
|---|---|
| Only documentation file changed | ✅ PASS |
| No production code modified | ✅ PASS |
| No frozen contracts modified | ✅ PASS |
| P4/P5 untouched | ✅ PASS |
| Working tree clean after commit | ✅ PASS |
