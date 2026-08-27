# P6-07-FINAL — Intelligence Presentation Freeze Declaration

**Date:** 2026-08-27
**Phase:** P6-07 Intelligence Presentation
**Status:** FROZEN
**Previous:** P6-07F legacy retirement & freeze readiness (`READY FOR PLANNER FREEZE`)

---

## 1. Executive Summary

P6-07 — Intelligence Presentation — is formally frozen.

All three Planner decisions (PD-07A-01, PD-07A-02, PD-07A-03) are verified PASS. All 20 presentation invariants (PV-01…PV-20) are verified PASS with zero violations. All frozen upstream contracts (P6-01…P6-06) remain untouched. P4 and P5 remain untouched. P5 replay remains untouched. Legacy presentation panels are retired from active production paths.

**P6-07 IS FROZEN.**

---

## 2. P6-07 Scope

P6-07 is the **Intelligence Presentation Layer** — the read/consumption boundary that makes frozen P6-01…P6-06 intelligence observable to users and downstream read-only consumers.

Frozen scope covers:

1. P6 downstream refresh wiring (P6-03 → P6-04 → P6-05 → P6-06)
2. P6-native read APIs (`/api/p6/*`)
3. Thin presentation DTOs (`src/lib/p6/presentation/`)
4. Coin intelligence presentation
5. Narrative intelligence presentation
6. Warning presentation
7. Empty/error presentation semantics
8. Legacy intelligence panel retirement (PD-07A-03)

---

## 3. Frozen Planner Decisions

| Decision | Frozen Resolution |
|---|---|
| **PD-07A-01** | `/api/refresh`: P6-03 → P6-04 → P6-05 → P6-06 sequential wiring. Each stage wrapped in try/catch (PD-E2). Never blocks refresh. |
| **PD-07A-02** | `/api/p6/*` GET read APIs with thin DTOs. Three endpoints: coins, narratives, warnings. GET-only. No mutation. No intelligence recalculation. |
| **PD-07A-03** | Retire P3IntelligencePanel, P4DecisionSupportPanel, P5ActionDecisionPanel from active production paths. Component files retained. |

All three decisions are ACCEPTED and now FROZEN.

---

## 4. Frozen Architecture

```text
Raw Data
   ↓
P6-01 Observation / Quality
   ↓
P6-02 Derived Features
   ↓
P6-03 Intelligence Snapshot
   ↓
P6-04 Trend / Regime
   ↓
P6-05 Early Warning
   ↓
P6-06 Intelligence Aggregation
   ↓
P6-07 Presentation
   ↓
/api/p6/*
   ↓
Thin DTOs
   ↓
P6-native UI
```

Refresh path:

```text
/api/refresh
    ↓
P6-03 (snapshot generation)
    ↓
P6-04 → P6-05 → P6-06 (downstream pipeline, PD-07A-01)
```

This architecture is frozen. Do not redesign during the freeze period.

---

## 5. Frozen API Surface

```text
GET /api/p6/coins/[id]
GET /api/p6/narratives/[id]
GET /api/p6/warnings/[entityType]/[entityId]
```

Properties:

- GET/read-only — no POST, PUT, DELETE, or PATCH
- Thin presentation boundary — no intelligence recalculation
- No action semantics — no ActionType, DecisionOutcome, BUY/SELL
- Compatible with P6-06 artifacts
- `force-dynamic` prevents static caching
- Invalid entity type → 400
- Invalid entity ID → 400
- Entity not found → 404
- No P6 data → `data: null` (success: true)
- Infrastructure failure → 500

Do not add new endpoints during the freeze period.

---

## 6. DTO Contract

Frozen presentation model:

```text
P6 domain artifacts
        ↓
thin DTO transformation
        ↓
UI
```

The presentation layer MUST NOT become a second intelligence engine.

No recalculation of:

- health
- confidence
- regime
- warnings
- quality
- freshness
- aggregation

DTO types (frozen in `src/lib/p6/presentation/types.ts`):

- `P6ApiResponse<T>` — standard response envelope
- `CoinIntelligenceDTO` — coin-level intelligence
- `NarrativeIntelligenceDTO` — narrative-level intelligence
- `WarningDTO` — warning occurrence
- `IntelligenceSummaryDTO` — structured explanation
- `ExplanationItemDTO` — individual explanation item
- `QualityMetadataDTO` — quality and freshness metadata

---

## 7. Coin/Narrative Symmetry

Coin and narrative presentation use equivalent DTO structure wherever the underlying artifact semantics permit.

| Field | Coin | Narrative | Symmetric |
|---|---|---|---|
| entity_type | `"coin"` | `"narrative"` | ✅ |
| health_score | `number \| null` | `number \| null` | ✅ |
| confidence | `number \| null` | `number \| null` | ✅ |
| regime | `string \| null` | `string \| null` | ✅ |
| regime_confidence | `number \| null` | `number \| null` | ✅ |
| regime_calculation_time | `string \| null` | `string \| null` | ✅ |
| warnings | `WarningDTO[]` | `WarningDTO[]` | ✅ |
| summary | `IntelligenceSummaryDTO \| null` | `IntelligenceSummaryDTO \| null` | ✅ |
| quality | `QualityMetadataDTO` | `QualityMetadataDTO` | ✅ |
| window_end | `string \| null` | `string \| null` | ✅ |
| version | `Record<string, string> \| null` | `Record<string, string> \| null` | ✅ |

Do not introduce special semantic rules for one entity type without a new future decision process.

---

## 8. Empty/Error Semantics

Frozen semantics:

| Scenario | Behavior |
|---|---|
| No P6 data | `data: null` (success: true) |
| Entity not found | `success: false, error: "Entity not found"` (404) |
| Invalid entity type | `success: false, error: "Invalid entity type"` (400) |
| Invalid entity ID | `success: false, error: "Invalid coin ID"` (400) |
| Infrastructure failure | `success: false, error: "..."` (500) |

Not-found remains distinguishable from empty. Infrastructure failure remains distinguishable. No fabricated P6 intelligence.

Do not reinterpret these semantics.

---

## 9. Warning/Regime Presentation

P6-04 regime, P6-05 warnings, and P6-06 summary are presented from their authoritative artifacts:

- `readCurrentRegime` → regime pass-through
- `readActiveWarnings` → warnings pass-through
- `readCurrentSummary` → summary pass-through

The UI must not regenerate, reinterpret, or replace them using legacy logic.

Warning presentation preserves:

- `warning_type`
- `severity`
- `lifecycle`
- `warning_id` (occurrence identity)
- `detection_window`

Regime presentation preserves:

- `regimeState` (pass-through string)
- `confidence`
- `calculationTime`

---

## 10. Quality/Freshness Boundary

Frozen distinction:

```
QualityState ≠ Freshness
```

Presentation may display both via `QualityMetadataDTO`:

- `quality_state: string`
- `freshness_state: string`

Presentation MUST NOT:

- merge them
- derive one from the other
- create a new QualityState
- treat infrastructure failure as quality degradation

---

## 11. Legacy Retirement

Final state:

```
P3IntelligencePanel       = RETIRED (0 active production occurrences)
P4DecisionSupportPanel    = RETIRED (0 active production occurrences)
P5ActionDecisionPanel     = RETIRED (0 active production occurrences)
```

Repository-wide search confirms:

| Component | Component file | Test files | Active production |
|---|---|---|---|
| P3IntelligencePanel | Retained | Retained | **0** |
| P4DecisionSupportPanel | Retained | Retained | **0** |
| P5ActionDecisionPanel | Retained | Retained | **0** |

Retirement method: imports removed from `src/app/narrative/[id]/page.tsx`. Component files NOT deleted. Test files NOT deleted. P4/P5 semantics NOT modified.

Reusable visual components retained:

- `HealthBadge` — still used in narrative page
- `ScoreChange` — still used in narrative page
- `ConfidenceBadge` — still used in narrative page

---

## 12. PV-01…PV-20 Invariant Audit

| ID | Invariant | Evidence | Result |
|---|---|---|---|
| **PV-01** | P6-07 consumes only P6-native artifacts | `read.ts` imports only from `p6/snapshot`, `p6/regime`, `p6/warning`, `p6/aggregation` | ✅ PASS |
| **PV-02** | P6-07 does not recalculate semantics | `read.ts` is pure DTO transformation, no calculation logic | ✅ PASS |
| **PV-03** | P6-07 is read-only | API routes export only `GET`; no POST/PUT/DELETE | ✅ PASS |
| **PV-04** | P6-07 output is deterministic | Same inputs → same DTOs; no randomness, no time-dependent logic | ✅ PASS |
| **PV-05** | Read API identity matches P6 identity | `entity_type` + `entity_id` used consistently in DTOs and routes | ✅ PASS |
| **PV-06** | Read APIs return only CURRENT | `readCurrentSnapshot`, `readCurrentRegime`, `readActiveWarnings` filter by CURRENT/ACTIVE | ✅ PASS |
| **PV-07** | Empty P6 state returns null | `readCoinIntelligence`/`readNarrativeIntelligence` return null when no data | ✅ PASS |
| **PV-08** | Provenance preserved | DTOs include `window_end`, `version` metadata | ✅ PASS |
| **PV-09** | Quality/Freshness independent | `QualityMetadataDTO` has separate `quality_state` and `freshness_state` | ✅ PASS |
| **PV-10** | P4 untouched | No P4 imports in any P6-07 file | ✅ PASS |
| **PV-11** | P5 untouched | No P5 imports in any P6-07 file | ✅ PASS |
| **PV-12** | No action semantics | No ActionType, DecisionOutcome in P6-07 | ✅ PASS |
| **PV-13** | No BUY/SELL semantics | No BUY/SELL strings in P6-07 files | ✅ PASS |
| **PV-14** | No legacy contamination | No legacy narrative-health imports in P6-07 presentation/API | ✅ PASS |
| **PV-15** | Refresh preserves ordering | Pipeline wired sequentially: P6-03 → P6-04 → P6-05 → P6-06 | ✅ PASS |
| **PV-16** | Partial failure does not block refresh | Each stage wrapped in try/catch with console.error | ✅ PASS |
| **PV-17** | Infra failure ≠ QualityState | No QualityState creation in P6-07 | ✅ PASS |
| **PV-18** | Explanation arrays always present | `IntelligenceSummaryDTO` has `what_changed`, `why`, `what_to_watch` arrays | ✅ PASS |
| **PV-19** | DTOs not engines | `read.ts` is pure transformation, no calculation logic | ✅ PASS |
| **PV-20** | No regime from score | No regime calculation in P6-07 | ✅ PASS |

**20/20 PASS. 0 violations.**

---

## 13. P4 Boundary

| Check | Result |
|---|---|
| P4 code modified | ❌ NO |
| P4 semantics reinterpreted | ❌ NO |
| P4 data consumed by P6-07 | ❌ NO |
| P4DecisionSupportPanel modified | ❌ NO — retired (import removed), not modified |
| P4 decision support leakage into P6 | ❌ NO |
| P4 policy semantics in P6 | ❌ NO |

**P4 untouched.** The retirement of `P4DecisionSupportPanel` is a presentation migration, not a modification of P4.

---

## 14. P5 Boundary

| Check | Result |
|---|---|
| P5 code modified | ❌ NO |
| P5 semantics reinterpreted | ❌ NO |
| P5 action semantics introduced into P6 | ❌ NO |
| P5ActionDecisionPanel modified | ❌ NO — retired (import removed), not modified |
| BUY/SELL vocabulary in P6 | ❌ NOT FOUND |
| Execution semantics in P6 | ❌ NOT FOUND |

**P5 untouched.** The retirement of `P5ActionDecisionPanel` does not modify P5.

---

## 15. P5 Replay Boundary

| Check | Result |
|---|---|
| P5 replay semantics changed | ❌ NO |
| P5 replay dependency created in P6 | ❌ NO |
| Historical decision artifacts modified | ❌ NO |
| P5 bridge created | ❌ NO |

**P5 replay untouched.**

---

## 16. P6-01…P6-06 Integrity

| Phase | Status |
|---|---|
| P6-01 Observation/Quality | ✅ FROZEN — untouched |
| P6-02 Derived Features | ✅ FROZEN — untouched |
| P6-03 Intelligence Snapshot | ✅ FROZEN — untouched |
| P6-04 Trend/Regime | ✅ FROZEN — untouched |
| P6-05 Early Warning | ✅ FROZEN — untouched |
| P6-06 Intelligence Aggregation | ✅ FROZEN — untouched |

No frozen P6-01…P6-06 contract is modified by P6-07.

---

## 17. Regression Results

| Suite | Tests | Result | Baseline (P6-07E) |
|---|---|---|---|
| P6 | **795** | ✅ PASS | 795 PASS |
| P4 | **150** | ✅ PASS | 129 PASS |
| P5 | **287** | ✅ PASS | 273 PASS |
| TypeScript | **—** | ✅ PASS (0 errors) | PASS |
| **Total** | **1232** | **PASS** | 1197 PASS |

Note: P4 and P5 test counts increased since P6-07E baseline due to additional tests added in those modules. All tests pass.

---

## 18. String/Import Safety Audit

| Search | Scope | Result |
|---|---|---|
| `BUY` | P6-07 presentation + API | ❌ Not found |
| `SELL` | P6-07 presentation + API | ❌ Not found |
| `EXECUTE` | P6-07 presentation + API | ❌ Not found |
| `APPROVE` | P6-07 presentation + API | ❌ Not found |
| `POLICY` | P6-07 presentation + API | ❌ Not found |
| P4 imports (`@/lib/p4`) | P6-07 presentation + API | ❌ Not found |
| P5 imports (`@/lib/p5`) | P6-07 presentation + API | ❌ Not found |
| Legacy narrative-health | P6-07 presentation + API | ❌ Not found |
| Legacy panel imports in app routes | `src/app/**` | ❌ Not found |

**No prohibited semantic dependency.**

---

## 19. Findings

| Class | Count | Details |
|---|---|---|
| **Class A — BLOCKING** | **0** | — |
| **Class B — CONTRACT VIOLATION** | **0** | — |
| **Class C — NON-BLOCKING** | **0** | — |
| **Class D — DEFERRED** | 1 | P6-08 historical comparison (out of scope for P6-07) |

---

## 20. Freeze Conditions

| Condition | Status |
|---|---|
| PD-07A-01 frozen | ✅ |
| PD-07A-02 frozen | ✅ |
| PD-07A-03 frozen | ✅ |
| PV-01…PV-20 = 20/20 PASS | ✅ |
| 0 PV violations | ✅ |
| 0 active legacy panel occurrences | ✅ |
| P6-native presentation verified | ✅ |
| P6 APIs verified | ✅ |
| Refresh wiring verified | ✅ |
| P4 untouched | ✅ |
| P5 untouched | ✅ |
| P5 replay untouched | ✅ |
| P6-01…P6-06 untouched | ✅ |
| No forbidden action semantics | ✅ |
| Regression tests pass | ✅ |
| Git boundary clean | ✅ |
| Freeze declaration committed | ✅ |

---

## 21. Git Boundary

| Check | Result |
|---|---|
| Only documentation file changed | ✅ PASS |
| No production code modified (in this task) | ✅ PASS |
| No frozen contracts modified | ✅ PASS |
| P4/P5 untouched | ✅ PASS |
| P6-01…P6-06 untouched | ✅ PASS |

Note: `src/app/narrative/[id]/page.tsx` was modified in P6-07F (legacy panel retirement) — this is the authorized PD-07A-03 implementation, not an accidental change.

---

## 22. P6 Pipeline Final State

```
P6-01 Observation / Quality       FROZEN
P6-02 Derived Features            FROZEN
P6-03 Intelligence Snapshot       FROZEN
P6-04 Trend / Regime              FROZEN
P6-05 Early Warning               FROZEN
P6-06 Intelligence Aggregation    FROZEN
P6-07 Intelligence Presentation   FROZEN
```

---

## 23. Final Freeze Declaration

```
P6-07 IS FROZEN
```

Frozen decisions:

```
PD-07A-01  Refresh wiring          FROZEN
PD-07A-02  Read API                FROZEN
PD-07A-03  Legacy retirement       FROZEN
```

Invariant state:

```
PV-01…PV-20 = 20/20 PASS
0 violations
```

Pipeline status:

```
P6-01 → P6-02 → P6-03 → P6-04 → P6-05 → P6-06 → P6-07
  ✅       ✅       ✅       ✅       ✅       ✅       ✅
```

All P6 phases through P6-07 are now frozen. The P6 intelligence pipeline is complete from observation through presentation.
