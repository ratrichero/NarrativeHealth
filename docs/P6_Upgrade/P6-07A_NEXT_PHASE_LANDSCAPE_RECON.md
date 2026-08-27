# P6-07A — Next Phase Landscape Recon

**Date:** 2026-08-27
**Phase:** P6-07
**Status:** LANDSCAPE RECON COMPLETE

---

## 1. Executive Summary

P6-06 Intelligence Aggregation is now FROZEN. The P6 pipeline produces authoritative intelligence artifacts:

```
P6-01 (Observation) → P6-02 (Features) → P6-03 (Snapshot)
  → P6-04 (Regime) → P6-05 (Warning) → P6-06 (Summary)
```

However, **no consumer currently reads these P6 artifacts**. The existing dashboard and narrative/coin pages use legacy data sources (P3 intelligence panels, P4 decision support panels, legacy narrative-health calculations). P6-07 must bridge this gap.

**Recommended P6-07 scope: P6 Intelligence Presentation Layer** — wire P6-06 summaries (and underlying P6-03/04/05 artifacts) into the existing UI through read APIs and presentation components, replacing legacy data sources without recalculating intelligence.

| Metric | Count |
|---|---|
| Total decisions | 6 |
| Blocking decisions | 3 |
| Non-blocking decisions | 2 |
| Deferred decisions | 1 |
| Evidence gaps | 5 (1 blocking) |
| Reusable components | 8 |
| Adaptation needed | 4 |
| Rejected | 3 |
| Deferred | 2 |

**Verdict: READY FOR P6-07B**

---

## 2. Current P6 Pipeline State

| Phase | Artifact | Status | Consumers |
|---|---|---|---|
| P6-01 | Observations, QualityState, FreshnessState | FROZEN | P6-02, P6-03 |
| P6-02 | Derived Features | FROZEN | P6-03 |
| P6-03 | Intelligence Snapshots | FROZEN | P6-06, refresh routes |
| P6-04 | Regime States | FROZEN | P6-06 |
| P6-05 | Warning Occurrences | FROZEN | P6-06 |
| P6-06 | Intelligence Summaries | FROZEN | **NONE** |

**Critical gap:** P6-06 summaries have zero consumers. The intelligence pipeline is complete but invisible.

---

## 3. Repository Evidence

### 3.1 Existing P6 Modules

```
src/lib/p6/
├── observation/      # P6-01: raw data + quality evaluation
├── feature/          # P6-02: derived features + persistence
├── snapshot/         # P6-03: intelligence snapshots + persistence
├── regime/           # P6-04: trend/regime detection
├── warning/          # P6-05: early warning engine
├── aggregation/      # P6-06: intelligence summaries
├── freshness/        # P6-01: freshness evaluation
├── quality/          # P6-01: quality evaluation
├── quality-persistence/ # P6-01: quality persistence
├── ingestion/        # P6-01: data ingestion hooks
└── registry/         # P6-01: source registry model
```

### 3.2 Existing UI Pages

| Page | Path | Data Source | P6 Consumer? |
|---|---|---|---|
| Dashboard (home) | `/` | `/api/dashboard` (legacy) | ❌ |
| Narrative Detail | `/narrative/[id]` | `/api/narratives/[id]` (legacy) | ❌ |
| Coin Detail | `/coin/[id]` | `/api/coins/[id]` (legacy) | ❌ |
| Snapshots | `/snapshots` | Unknown | ❌ |
| Admin | `/admin` | Various admin APIs | ❌ |

### 3.3 Existing Legacy Panels in Narrative/Coin Pages

| Panel | Component | Source |
|---|---|---|
| P3 Intelligence | `P3IntelligencePanel` | P3 legacy |
| P4 Decision Support | `P4DecisionSupportPanel` | P4 legacy |
| P5 Action Decision | `P5ActionDecisionPanel` | P5 legacy |

These panels consume legacy data, not P6 artifacts.

### 3.4 Refresh Routes

| Route | P6 Integration |
|---|---|
| `/api/refresh` | P6-01 observation + P6-03 snapshot generation |
| `/api/refresh/coin/[id]` | P6-01 observation + P6-03 snapshot generation |
| `/api/refresh/narrative/[id]` | Narrative refresh (no P6 aggregation) |

**P6-04 regime, P6-05 warnings, P6-06 summaries are NOT wired into refresh.**

### 3.5 P6 Read APIs

| Function | Location | Status |
|---|---|---|
| `readCurrentSnapshot` | `p6/snapshot/persistence.ts` | ✅ Implemented |
| `readCurrentCoinSnapshots` | `p6/snapshot/persistence.ts` | ✅ Implemented |
| `readCurrentSummary` | `p6/aggregation/persistence.ts` | ✅ Implemented |
| Dashboard API | `/api/dashboard` | Legacy — does not read P6 |
| Narrative API | `/api/narratives/[id]` | Legacy — does not read P6 |
| Coin API | `/api/coins/[id]` | Legacy — does not read P6 |

---

## 4. Candidate Next-Phase Capabilities

| Candidate | Evidence | Inputs | Outputs | Reuse | Risk | Recommendation |
|---|---|---|---|---|---|---|
| **A. P6 Presentation Layer** | Existing UI pages use legacy data; P6 artifacts have zero consumers | P6-03/04/05/06 | Read APIs + UI components | High (existing pages, UI library) | Low | **RECOMMENDED** |
| B. Historical Intelligence | Deferred by PD-06A-03 (P6-08 scope) | P6-03 snapshots over time | Historical comparison | Medium | Medium | DEFER to P6-08 |
| C. Cross-Entity Correlation | Deferred by P6-06 | P6-03/04 across entities | Correlation analysis | Low | High | DEFER |
| D. Warning Delivery | P6-05 warnings exist but no delivery mechanism | P6-05 warnings | Push notifications, email | Low | Medium | DEFER (presentation concern) |
| E. Refresh Wiring | P6-04/05/06 not wired into refresh pipeline | P6-04/05/06 | Pipeline completion | High | Low | INCLUDE in P6-07 |
| F. Intelligence Timeline | No historical P6 data exists yet | P6-03 snapshots | Timeline visualization | Low | Medium | DEFER to P6-08 |

**Candidate A is the clear winner.** The P6 pipeline produces rich artifacts that nobody can see. P6-07 must make them visible.

---

## 5. P6-07 Purpose

### What P6-07 IS

P6-07 is the **P6 Intelligence Presentation Layer**. Its purpose is to:

1. Expose P6-03/04/05/06 artifacts through read APIs
2. Wire P6-04 regime and P6-05 warnings into the refresh pipeline
3. Replace legacy P3/P4/P5 UI panels with P6-native presentation
4. Enable users to understand P6 intelligence without technical internals

### What P6-07 IS NOT

- NOT a new intelligence calculation engine
- NOT historical comparison (P6-08)
- NOT cross-entity correlation (deferred)
- NOT warning delivery/push notifications (separate concern)
- NOT a BUY/SELL engine
- NOT a P5 bridge or action layer
- NOT a replacement for P6-06 aggregation semantics

---

## 6. P6-07 Scope

### In Scope

1. **Read APIs** for P6-03 snapshots, P6-04 regime, P6-05 warnings, P6-06 summaries
2. **Refresh wiring** for P6-04 regime detection and P6-05 warning generation
3. **Narrative dashboard** consuming P6-06 summary + P6-04 regime + P6-05 warnings
4. **Narrative detail** page consuming P6-06 explanation + upstream artifacts
5. **Coin detail** page consuming P6-03 snapshot + P6-04 regime + P6-05 warnings
6. **UI contract tests** verifying no BUY/SELL/action semantics in presentation

### Out of Scope

- Historical comparison (P6-08)
- Cross-entity correlation (deferred)
- Warning delivery/push (separate product concern)
- New intelligence calculations
- P4/P5 modifications

---

## 7. Explicit Non-Goals

| Non-Goal | Reason |
|---|---|
| Historical multi-window comparison | Deferred to P6-08 per PD-06A-03 |
| Cross-narrative correlation | Deferred — no frozen contract |
| Warning push/email delivery | Product delivery concern, not intelligence |
| New health/regime/warning calculations | P6-01…P6-06 are frozen |
| LLM-generated explanations | PD-06A-02 forbids LLM prose |
| BUY/SELL semantics | P6 boundary — never |
| P5 action execution | P6 boundary — never |

---

## 8. Architecture Recon

```
P6-01 → P6-02 → P6-03 → P6-04 → P6-05 → P6-06
  ↓        ↓        ↓        ↓        ↓        ↓
Obs.    Features  Snapshots Regime  Warnings  Summary
  ↓        ↓        ↓        ↓        ↓        ↓
  └────────┴────────┴────────┴────────┴────────┘
                         ↓
                   Read APIs (P6-07)
                         ↓
                   UI Components (P6-07)
                         ↓
                   Narrative/Coin Pages (P6-07)
```

---

## 9. Authoritative Input Inventory

| Input | Source | Authority | P6-07 Usage |
|---|---|---|---|
| Intelligence Snapshot | P6-03 | AUTHORITATIVE | Read API → UI |
| Regime State | P6-04 | AUTHORITATIVE | Read API → UI + refresh wiring |
| Warning Occurrences | P6-05 | AUTHORITATIVE | Read API → UI + refresh wiring |
| Intelligence Summary | P6-06 | AUTHORITATIVE | Read API → UI |
| QualityState | P6-01 | METADATA | Pass-through to UI |
| FreshnessState | P6-01 | METADATA | Pass-through to UI |
| Health Score | P6-03 | DERIVED | Via snapshot |
| Confidence | P6-03 | DERIVED | Via snapshot |

---

## 10. Deferred Decision Audit

| Deferred Item | Owner | Should P6-07 Resolve? | Reason |
|---|---|---|---|
| Historical comparison | P6-08 | NO | Explicitly deferred to P6-08 |
| Cross-entity correlation | Future | NO | No frozen contract |
| Acknowledgement workflow | Future | NO | No frozen contract |
| Refresh wiring for P6-04/05 | P6-07 | YES | Required for pipeline completeness |
| P6-06 summary read API | P6-07 | YES | Required for presentation |

---

## 11. Presentation / Dashboard Audit

### Current State

| Page | Legacy Data | P6 Data | Gap |
|---|---|---|---|
| `/` (Dashboard) | NarrativeCard, SourceStatusBar | None | Full replacement needed |
| `/narrative/[id]` | P3IntelligencePanel, P4DecisionSupportPanel, P5ActionDecisionPanel | None | Replace with P6 panels |
| `/coin/[id]` | ScoreBreakdown, HealthTimeline, indicators | None | Replace with P6 panels |

### Semantic Duplication Risk

The existing `P3IntelligencePanel`, `P4DecisionSupportPanel`, and `P5ActionDecisionPanel` consume legacy data. If P6-07 replaces them with P6-native panels, there is no semantic duplication — the legacy panels are simply retired.

**UI MUST NOT become a second intelligence engine.** P6-07 presentation must consume P6 artifacts without recalculating.

---

## 12. Historical Intelligence Audit

Historical comparison is:

- **Absent** from P6-06 (explicitly deferred by PD-06A-03)
- **Absent** from the repository (no historical P6 snapshot browsing)
- **Deferred** to P6-08 per the execution plan

P6-07 should NOT implement historical comparison. It may present the latest/current P6 artifacts only.

---

## 13. Cross-Entity Intelligence Audit

Cross-entity intelligence:

- **Not justified** by repository evidence
- **Deferred** by P6-06
- Coin → narrative aggregation already handled by P6-06
- Narrative → narrative correlation has no frozen contract

P6-07 should NOT introduce cross-entity intelligence.

---

## 14. API / Integration Audit

### Current P6 Read APIs

| API | Status | Consumer |
|---|---|---|
| `readCurrentSnapshot` | Implemented | None (internal only) |
| `readCurrentCoinSnapshots` | Implemented | None (internal only) |
| `readCurrentSummary` | Implemented | None (internal only) |

### Needed P6-07 APIs

| API | Purpose |
|---|---|
| `/api/p6/summaries` | List current summaries (coin + narrative) |
| `/api/p6/summaries/[entityType]/[entityId]` | Get current summary for entity |
| `/api/p6/snapshots/[entityType]/[entityId]` | Get current snapshot for entity |
| `/api/p6/regime/[entityType]/[entityId]` | Get current regime for entity |
| `/api/p6/warnings/[entityType]/[entityId]` | Get current warnings for entity |

### Refresh Wiring

P6-04 regime detection and P6-05 warning generation should be wired into the refresh pipeline after P6-03 snapshot generation.

---

## 15. Output Artifact Analysis

P6-07 does NOT produce a new semantic artifact.

P6-07 is a **presentation/consumption layer** that reads existing P6-03/04/05/06 artifacts.

No new persistence table is required.

No new version tuple is required.

No new lifecycle states are required.

P6-07 may create **presentation-only view models** (not persisted) that transform P6 artifacts into UI-consumable shapes.

---

## 16. Quality / Freshness Semantics

P6-07 must:

- Pass QualityState and FreshnessState through as metadata
- NOT reinterpret QualityState
- NOT collapse Freshness into Quality
- NOT treat infrastructure failure as data-quality degradation

Quality and freshness appear in the UI as read-only indicators.

---

## 17. Provenance

P6-07 presentation must preserve upstream provenance:

- Snapshot provenance (P6-03)
- Regime provenance (P6-04)
- Warning provenance (P6-05)
- Summary provenance (P6-06)

Provenance may be exposed in a collapsed "technical details" section.

---

## 18. Versioning

P6-07 does not create a new version tuple.

P6-07 reads existing P6-03/04/05/06 versions.

Version information may be displayed in the UI for transparency.

---

## 19. Persistence

P6-07 does NOT create new persistence tables.

P6-07 reads from existing P6 tables:

- `p6_snapshots`
- `p6_regime_states`
- `p6_warnings`
- `p6_intelligence_summaries`

---

## 20. Lifecycle

P6-07 does NOT create new lifecycle states.

P6-07 reads existing lifecycle states:

- Snapshot: CURRENT | SUPERSEDED
- Regime: ACTIVE | SUPERSEDED
- Warning: DETECTED | ACTIVE | RESOLVED | SUPERSEDED
- Summary: CURRENT | SUPERSEDED

---

## 21. Legacy Reuse Audit

| Component | Classification | Reason |
|---|---|---|
| `P3IntelligencePanel` | **DO NOT USE** | Legacy P3 data source, no P6 integration |
| `P4DecisionSupportPanel` | **DO NOT USE** | Legacy P4 data source, semantic boundary |
| `P5ActionDecisionPanel` | **DO NOT USE** | Legacy P5 data source, semantic boundary |
| `HealthBadge` | **REUSE** | Presentation-only, no intelligence semantics |
| `ScoreChange` | **REUSE** | Presentation-only, delta display |
| `ConfidenceBadge` | **REUSE** | Presentation-only, confidence display |
| `CoinRankingTable` | **ADAPT** | Needs P6 data source instead of legacy |
| `CorrelationHeatmap` | **DEFER** | Cross-entity, not P6-07 scope |
| `HealthTimeline` | **ADAPT** | Needs P6 snapshot data source |
| Legacy narrative-health | **DO NOT USE** | Legacy calculation, not P6-native |

---

## 22. P4 Boundary Audit

| Check | Result |
|---|---|
| P6-07 does NOT become decision support | ✅ |
| P6-07 does NOT consume P4 as intelligence input | ✅ |
| P6-07 does NOT create BUY/SELL semantics | ✅ |
| P6-07 does NOT create action semantics | ✅ |
| P4 decision support panels are retired | ✅ (legacy replacement) |

**P4 untouched. No boundary breach.**

---

## 23. P5 Boundary / Replay Audit

| Check | Result |
|---|---|
| P6-07 does NOT modify P5 | ✅ |
| P6-07 does NOT reinterpret P5 decisions | ✅ |
| P6-07 does NOT create action semantics | ✅ |
| P6-07 does NOT create P5 replay contamination | ✅ |
| P5 action panels are retired | ✅ (legacy replacement) |

**P5 untouched. No replay contamination.**

---

## 24. Explicit Decision Inventory

Decisions already established by frozen P6 contracts that constrain P6-07:

| Decision | Source | P6-07 Impact |
|---|---|---|
| PD-06A-01 | P6-06 | Summary scope is defined; P6-07 consumes it |
| PD-06A-02 | P6-06 | Explanation format is defined; P6-07 renders it |
| PD-06A-03 | P6-06 | Change detection is two-point; P6-07 displays deltas |
| PD-06A-04 | P6-06 | Empty population produces no summary; P6-07 must handle gracefully |
| PD-06C-01 | P6-06 | window_end is deterministic; P6-07 may display it |

---

## 25. New Decision Inventory

| ID | Question | Proposed | Status | Blocking |
|---|---|---|---|---|
| **PD-07A-01** | Should P6-07 wire P6-04/05 into refresh pipeline? | YES — regime + warnings run after snapshot | PROPOSED | **YES** |
| **PD-07A-02** | Should P6-07 create new read APIs or adapt existing ones? | NEW read APIs (`/api/p6/*`) for clean separation | PROPOSED | **YES** |
| **PD-07A-03** | Should legacy P3/P4/P5 panels be retired or kept alongside P6? | RETIRE — replace with P6-native panels | PROPOSED | **YES** |
| **PD-07A-04** | Should P6-07 presentation use view models or raw P6 artifacts? | View models (presentation-only transformation) | PROPOSED | No |
| **PD-07A-05** | Should P6-07 include a "technical details" collapsed section? | YES — provenance, version, freshness in collapsible panel | PROPOSED | No |
| **PD-07A-06** | Should P6-07 handle empty/degraded P6 states explicitly? | YES — graceful fallback for missing summaries | PROPOSED | No |

---

## 26. Blocking Decisions

| ID | Question | Why Blocking |
|---|---|---|
| PD-07A-01 | Refresh wiring for P6-04/05 | Without this, P6-04/05 never run; P6-06 has no input |
| PD-07A-02 | Read API design | UI cannot consume P6 artifacts without APIs |
| PD-07A-03 | Legacy panel retirement | Determines whether P6-07 replaces or supplements legacy UI |

---

## 27. Non-Blocking Decisions

| ID | Question | Default |
|---|---|---|
| PD-07A-04 | View models vs raw artifacts | View models (safe default) |
| PD-07A-05 | Technical details section | Collapsible panel (safe default) |
| PD-07A-06 | Empty/degraded state handling | Graceful fallback (safe default) |

---

## 28. Deferred Decisions

| ID | Question | Reason |
|---|---|---|
| Historical comparison | P6-08 scope | Explicitly deferred |
| Cross-entity correlation | No frozen contract | Deferred |
| Warning delivery mechanism | Product concern | Separate phase |

---

## 29. Evidence Gaps

| Gap | Blocking? | Impact |
|---|---|---|
| P6-04/05 refresh wiring not implemented | **YES** | Pipeline incomplete; P6-06 cannot receive regime/warnings |
| No P6 read APIs exist | **YES** | UI cannot consume P6 artifacts |
| Legacy UI pages use hardcoded legacy data sources | No | P6-07 must replace, not adapt |
| No P6 summary data exists in production | No | P6-07 must handle empty state gracefully |
| P6 snapshot read APIs are internal only | No | P6-07 must expose them via HTTP |

---

## 30. Dependency Graph

```
PD-07A-01 (Refresh wiring)
    ↓
PD-07A-02 (Read APIs)
    ↓
PD-07A-03 (Legacy retirement)
    ↓
P6-07B — Narrative Dashboard
    ↓
P6-07C — Narrative Detail
    ↓
P6-07D — Coin Detail
    ↓
P6-07E — UI Contract Tests
    ↓
P6-07-FINAL
```

---

## 31. Recommended V1 Scope

P6-07 should contain:

1. **Refresh wiring** — P6-04 regime + P6-05 warnings after P6-03 snapshot
2. **Read APIs** — `/api/p6/*` endpoints for summaries, snapshots, regime, warnings
3. **Narrative dashboard** — P6-06 summary + regime + warnings for narrative list
4. **Narrative detail** — Full P6-06 explanation + upstream artifacts
5. **Coin detail** — P6-03 snapshot + P6-04 regime + P6-05 warnings for coin
6. **UI contract tests** — Verify no BUY/SELL/action semantics

**Excluded:**
- Historical comparison (P6-08)
- Cross-entity correlation (deferred)
- Warning delivery (separate concern)
- New intelligence calculations

---

## 32. Recommended Execution Sequence

```
P6-07A  Landscape Recon ← YOU ARE HERE
  ↓
P6-07B  Semantic Contract
  ↓
P6-07C  Decision Inventory + Gap Audit
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

## 33. Readiness Verdict

```
READY FOR P6-07B
```

3 blocking decisions identified. All have clear proposed resolutions. The P6-07 scope is architecturally necessary (P6 pipeline has zero consumers), dependency-ready (P6-01…P6-06 all frozen), and boundary-safe (no P4/P5 risk).

---

## 34. Git Boundary

| Check | Result |
|---|---|
| Only documentation file changed | ✅ PASS |
| No production code modified | ✅ PASS |
| No frozen contracts modified | ✅ PASS |
| P4/P5 untouched | ✅ PASS |
| Working tree clean after commit | ✅ PASS |
