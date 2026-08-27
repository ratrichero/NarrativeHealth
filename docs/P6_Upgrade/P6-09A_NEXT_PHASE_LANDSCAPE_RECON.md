# P6-09A — Next Phase Landscape Recon

**Date:** 2026-08-27
**Phase:** P6-09
**Status:** LANDSCAPE RECON COMPLETE
**Previous:** P6-08-FINAL Historical Intelligence Freeze (`P6-08 IS FROZEN`)

---

## 1. Executive Summary

P6-08 Historical Intelligence is FROZEN. The complete P6 pipeline is:

```
P6-01 (Observation) → P6-02 (Features) → P6-03 (Snapshot)
  → P6-04 (Regime) → P6-05 (Warning) → P6-06 (Summary)
  → P6-07 (Presentation) → P6-08 (Historical Comparison)
```

All eight phases are frozen. However, **codebase inspection reveals critical integration gaps** between the frozen P6 backend and the existing UI layer. The P6 master specification defines P6-09 as **"System Verification & Product Value Audit"** — verifying the complete P6 system and user value before freeze.

This recon identifies that P6-09 cannot be a pure audit task. There are real integration gaps that must be resolved before the system can be meaningfully verified.

**Verdict: READY FOR P6-09B — with scope clarification required**

---

## 2. Current P6 Pipeline State

| Phase | Artifact | Status | UI Integration |
|---|---|---|---|
| P6-01 | Observations, QualityState, FreshnessState | FROZEN | ✅ Ingestion runs in refresh |
| P6-02 | Derived Features | FROZEN | ✅ Features computed in refresh |
| P6-03 | Intelligence Snapshots | FROZEN | ✅ Snapshots generated in refresh |
| P6-04 | Regime States | FROZEN | ⚠️ Engine exists but not fully wired in refresh |
| P6-05 | Warning Occurrences | FROZEN | ⚠️ Engine exists but not fully wired in refresh |
| P6-06 | Intelligence Summaries | FROZEN | ⚠️ Engine exists but not fully wired in refresh |
| P6-07 | Presentation DTOs | FROZEN | ⚠️ API exists but UI uses legacy endpoints |
| P6-08 | Historical Comparison | FROZEN | ❌ API exists but NOT wired into UI |

---

## 3. Critical Integration Gaps

### 3.1 P6-04/P6-05/P6-06 Pipeline Wiring

The P6-07 downstream pipeline wiring (`PD-07A-01`) exists in `src/app/api/refresh/route.ts`:

```typescript
const { runP6DownstreamPipeline } = await import("@/lib/p6/presentation/pipeline");
const pipelineResult = await runP6DownstreamPipeline();
```

However, `runP6DownstreamPipeline()` in `src/lib/p6/presentation/pipeline.ts` is a **stub** — it reads current coin snapshots but does NOT invoke the actual P6-04 regime engine, P6-05 warning engine, or P6-06 aggregation engine. The pipeline result counts are always zero.

**Impact:** P6-04 regime, P6-05 warnings, and P6-06 summaries are NOT being generated during refresh. The P6 API endpoints return empty/null for these artifacts.

### 3.2 P6-07 Presentation API Not Used by UI

The narrative page (`src/app/narrative/[id]/page.tsx`) imports P6-07F comment but still fetches from legacy API:

```typescript
const response = await fetch(`/api/narratives/${id}`);  // Legacy P0/P1 endpoint
```

Not from:

```typescript
const response = await fetch(`/api/p6/narratives/${id}`);  // P6-07 endpoint
```

**Impact:** UI shows legacy health calculations, not P6-native intelligence.

### 3.3 P6-08 Historical API Not Wired into UI

The P6-08 historical API (`GET /api/p6/history/[entityType]/[id]`) exists but:

- No UI component calls it
- The narrative page has no historical comparison section
- The coin page has no historical comparison section
- The `HealthTimeline` component uses legacy `/api/coins/${coinId}/health-timeline`

**Impact:** P6-08 historical comparison is backend-complete but invisible to users.

### 3.4 P6-06 Downstream Pipeline Incomplete

The `runP6DownstreamPipeline()` function:

```typescript
export async function runP6DownstreamPipeline(): Promise<PipelineResult> {
  const result: PipelineResult = { regimeCount: 0, warningCount: 0, summaryCount: 0 };
  // ... reads snapshots but does not invoke engines
  return result;
}
```

**Impact:** No P6-04/05/06 artifacts are generated. P6-07 presentation returns empty data.

---

## 4. What P6-09 Should Be

### 4.1 Master Specification Definition

P6-09 per P6 master specification (§15):

> **P6-09 — System Verification & Product Value Audit**
> 
> Goal: verify the complete P6 system and user value before freeze.
> 
> Checks:
> - contract integrity
> - provenance
> - reproducibility
> - data quality
> - alert quality
> - semantic boundary
> - UI comprehension
> - regression

### 4.2 Actual Need

The master spec assumes a complete, wired system. **The system is NOT complete.** Before verification can be meaningful, the following must be resolved:

1. **P6-04/05/06 pipeline must be fully wired** — engines invoked during refresh
2. **P6-07 presentation must be consumed by UI** — narrative/coin pages use P6 API
3. **P6-08 historical must be wired into UI** — historical comparison visible to users

### 4.3 Recommended P6-09 Scope

Given the gaps, P6-09 should be split into:

**P6-09A** (this task): Landscape recon identifying gaps

**P6-09B**: Pipeline completion — wire P6-04/05/06 engines into refresh

**P6-09C**: UI integration — wire P6-07/P6-08 into narrative/coin pages

**P6-09D**: System verification audit — verify complete P6 system

**P6-09-FINAL**: Verification freeze

---

## 5. Explicit Non-Goals

| Non-Goal | Reason |
|---|---|
| New P6 intelligence engines | P6-01…P6-08 engines are frozen and complete |
| New persistence tables | All needed tables exist |
| New API endpoints | P6-07/P6-08 APIs exist |
| P4/P5 modification | Boundary preserved |
| Action/BUY/SELL semantics | Explicitly forbidden |
| Cross-entity correlation | Deferred to future |
| Rolling window analytics | Deferred to future |
| Custom date ranges | Deferred to P6-08 future |
| Backfill | Deferred from P6-08 |

---

## 6. Reusable Components

| Component | Location | Classification |
|---|---|---|
| P6-04 regime engine | `src/lib/p6/regime/engine.ts` | **REUSE** — invoke in pipeline |
| P6-05 warning engine | `src/lib/p6/warning/engine.ts` | **REUSE** — invoke in pipeline |
| P6-06 aggregation engine | `src/lib/p6/aggregation/` | **REUSE** — invoke in pipeline |
| P6-07 presentation read | `src/lib/p6/presentation/read.ts` | **REUSE** — wire into UI |
| P6-08 historical engine | `src/lib/p6/historical/engine.ts` | **REUSE** — wire into UI |
| P6-08 historical API | `src/app/api/p6/history/` | **REUSE** — wire into UI |
| P6-07 presentation API | `src/app/api/p6/coins/`, `narratives/` | **REUSE** — wire into UI |
| HealthBadge | `src/components/HealthBadge.tsx` | **REUSE** — already used |
| ScoreChange | `src/components/ScoreChange.tsx` | **REUSE** — already used |
| ConfidenceBadge | `src/components/ConfidenceBadge.tsx` | **REUSE** — already used |
| HealthTimeline | `src/components/health-timeline.tsx` | **ADAPT** — switch to P6-08 API |

---

## 7. Components Requiring Adaptation

| Component | Current State | Required Change |
|---|---|---|
| `runP6DownstreamPipeline()` | Stub — no engine invocation | Wire P6-04/05/06 engines |
| Narrative page | Uses legacy `/api/narratives/${id}` | Switch to `/api/p6/narratives/${id}` |
| Coin page | Uses legacy health-timeline API | Switch to P6-08 timeline |
| HealthTimeline component | Uses `/api/coins/${coinId}/health-timeline` | Switch to `/api/p6/history/coin/${id}?timeline=true` |

---

## 8. Components Rejected

| Component | Reason |
|---|---|
| `p3NarrativeIntelligence` | P3 legacy, not P6-native |
| `morning_snapshots` | Legacy format |
| `decisionSignals` | P2 legacy |
| `narrativeMomentum` | P2 legacy |
| Legacy health-timeline API | Not P6-native |

---

## 9. Dependency on P6-01…P6-08

| Dependency | Type | Impact |
|---|---|---|
| P6-03 snapshots | Read | Pipeline reads snapshots for regime/warning/summary |
| P6-04 regime engine | Invoke | Must be called in pipeline |
| P6-05 warning engine | Invoke | Must be called in pipeline |
| P6-06 aggregation engine | Invoke | Must be called in pipeline |
| P6-07 presentation API | Consume | UI must call P6 API |
| P6-08 historical API | Consume | UI must call P6 history API |

**No frozen P6-01…P6-08 contracts are modified.**

---

## 10. P4/P5 Boundary

| Check | Result |
|---|---|
| P4 modification required | ❌ No |
| P5 modification required | ❌ No |
| P4 data consumed by P6-09 | ❌ No |
| P5 data consumed by P6-09 | ❌ No |
| P4 imports in P6-09 | ❌ None |
| P5 imports in P6-09 | ❌ None |

**P4/P5 untouched.**

---

## 11. Persistence/API/UI Implications

### 11.1 Persistence

| Change | Required |
|---|---|
| New tables | ❌ No |
| Schema modifications | ❌ No |
| New indexes | ❌ No |
| Migrations | ❌ No |

### 11.2 API

| Change | Required |
|---|---|
| New endpoints | ❌ No — P6-07/P6-08 endpoints exist |
| Modify existing endpoints | ❌ No |
| Deprecate legacy endpoints | ❌ No — keep for backward compatibility |

### 11.3 UI

| Change | Required |
|---|---|
| New components | ⚠️ Possibly — P6-08 comparison UI |
| Modify existing pages | ✅ Yes — wire P6 API |
| New pages | ❌ No |

---

## 12. Hidden Assumptions

| Assumption | Risk | Mitigation |
|---|---|---|
| P6-04/05/06 engines work when invoked | Medium | Test with real data after wiring |
| P6-07 API returns correct DTOs | Low | Already tested in P6-07 |
| P6-08 API returns correct comparison | Low | Already tested in P6-08 |
| Legacy API can coexist with P6 API | Low | Different endpoints, no conflict |
| UI can switch APIs without breaking | Medium | Test each page migration |

---

## 13. Evidence Gaps

| Gap | Blocking? | Impact | Resolution |
|---|---|---|---|
| P6-04/05/06 pipeline not wired | **YES** | No regime/warnings/summaries generated | Wire engines in P6-09B |
| UI uses legacy API, not P6 API | **YES** | UI shows legacy data, not P6 intelligence | Migrate UI in P6-09C |
| P6-08 historical not in UI | **YES** | Historical comparison invisible | Wire in P6-09C |
| P6-06 downstream pipeline is stub | **YES** | No aggregation artifacts | Complete in P6-09B |

---

## 14. Decision Inventory

### 14.1 Explicit Decisions (Inherited)

| Decision | Source | P6-09 Impact |
|---|---|---|
| PD-07A-01 | P6-07 | Pipeline wiring exists but incomplete |
| PD-07A-02 | P6-07 | P6 API exists, UI must consume it |
| PD-07A-03 | P6-07 | Legacy panels retired from narrative page |
| PD-08A-01 | P6-08 | Derive on-read — no persistence changes |
| PD-08A-02 | P6-08 | Fixed windows — no new API parameters |
| PD-08A-03 | P6-08 | Membership at time — no UI change needed |
| PD-08C-03 | P6-08 | Warning matching — no UI change needed |
| PD-08C-04 | P6-08 | Membership reconstruction — no UI change needed |

### 14.2 New Decisions Required

| ID | Question | Proposed | Status | Blocking |
|---|---|---|---|---|
| **PD-09A-01** | Should P6-09 wire P6-04/05/06 engines into refresh pipeline? | Yes — complete the pipeline | PROPOSED | **YES** |
| **PD-09A-02** | Should P6-09 migrate UI from legacy API to P6 API? | Yes — narrative and coin pages | PROPOSED | **YES** |
| **PD-09A-03** | Should P6-09 wire P6-08 historical into UI? | Yes — add comparison section | PROPOSED | **YES** |
| **PD-09A-04** | Should P6-09 keep legacy API endpoints for backward compatibility? | Yes — do not deprecate | PROPOSED | No |
| **PD-09A-05** | Should P6-09 add P6-08 comparison UI components? | Yes — comparison cards/timeline | PROPOSED | No |
| **PD-09A-06** | Should P6-09 verify P6 system end-to-end after wiring? | Yes — system verification audit | PROPOSED | No |

### 14.3 Blocking Decisions

| ID | Question | Why Blocking |
|---|---|---|
| PD-09A-01 | Wire P6-04/05/06 into refresh | Without this, P6 pipeline produces no regime/warnings/summaries |
| PD-09A-02 | Migrate UI to P6 API | Without this, UI shows legacy data, not P6 intelligence |
| PD-09A-03 | Wire P6-08 into UI | Without this, historical comparison is invisible |

---

## 15. Dependency Graph

```
P6-09A (this recon)
    ↓
PD-09A-01 (wire pipeline)
    ↓
P6-09B (pipeline completion)
    ↓
PD-09A-02 (migrate UI)
    ↓
P6-09C (UI integration)
    ↓
PD-09A-03 (wire historical)
    ↓
P6-09D (system verification)
    ↓
P6-09-FINAL (verification freeze)
    ↓
P6-FINAL (baseline freeze & handoff)
```

---

## 16. Recommended V1 Scope

### In Scope (P6-09B)

1. Wire P6-04 regime engine into `runP6DownstreamPipeline()`
2. Wire P6-05 warning engine into `runP6DownstreamPipeline()`
3. Wire P6-06 aggregation engine into `runP6DownstreamPipeline()`
4. Verify pipeline produces regime/warnings/summaries
5. Run regression after wiring

### In Scope (P6-09C)

1. Migrate narrative page to P6-07 API
2. Migrate coin page to P6-07 API
3. Add P6-08 historical comparison section to narrative page
4. Add P6-08 historical comparison section to coin page
5. Update HealthTimeline to use P6-08 API
6. Verify UI shows P6-native intelligence

### In Scope (P6-09D)

1. End-to-end system verification
2. Contract integrity audit
3. Provenance audit
4. Data quality audit
5. Alert quality audit
6. UI comprehension audit
7. Regression audit
8. P4/P5 boundary audit

### Out of Scope

- New P6 intelligence engines
- New persistence tables
- New API endpoints
- Cross-entity correlation
- Rolling window analytics
- Custom date ranges
- Backfill
- Action/BUY/SELL semantics

---

## 17. Recommended Execution Sequence

```
P6-09A  Landscape Recon ← YOU ARE HERE
  ↓
P6-09B  Pipeline Completion (wire P6-04/05/06)
  ↓
P6-09C  UI Integration (wire P6-07/P6-08 into pages)
  ↓
P6-09D  System Verification Audit
  ↓
P6-09-FINAL  Verification Freeze
  ↓
P6-FINAL  Baseline Freeze & Handoff
```

---

## 18. Readiness Verdict

```
READY FOR P6-09B
```

3 blocking decisions identified. All have clear proposed resolutions. The P6-09 scope is architecturally justified (pipeline incomplete, UI uses legacy APIs, historical not wired), dependency-ready (P6-01…P6-08 all frozen), and boundary-safe (no P4/P5 risk).

P6-09B implementation may proceed with the accepted decisions as the authoritative contract.

---

## 19. Git Boundary

| Check | Result |
|---|---|
| Only documentation file changed | ✅ PASS |
| No production code modified | ✅ PASS |
| No frozen contracts modified | ✅ PASS |
| P4/P5 untouched | ✅ PASS |
| P6-01…P6-08 untouched | ✅ PASS |
| No schema changes | ✅ PASS |
| No API changes | ✅ PASS |
| Working tree clean after commit | ✅ PASS |
