# P6-07B — Intelligence Presentation Semantic Contract

**Date:** 2026-08-27
**Phase:** P6-07 Intelligence Presentation
**Status:** SEMANTIC CONTRACT COMPLETE
**Previous:** P6-07A landscape recon (`1f803ce`)

---

## 1. Executive Summary

P6-07 is the **P6 Intelligence Presentation Layer** — the read/consumption boundary that makes frozen P6-01…P6-06 intelligence observable to users. The P6 pipeline produces authoritative artifacts (snapshots, regimes, warnings, summaries) but currently has **zero consumers**. P6-07 bridges this gap through read APIs and presentation components without recalculating any intelligence.

This contract defines 8 new decisions (PD-07B-01…08), 18 proposed invariants (PV-01…18), and identifies 3 blocking decisions.

**Verdict: READY FOR P6-07C**

---

## 2. Current Frozen Pipeline

```
P6-01 Observation/Quality    → FROZEN
P6-02 Derived Features       → FROZEN
P6-03 Intelligence Snapshot  → FROZEN
P6-04 Trend/Regime           → FROZEN
P6-05 Early Warning          → FROZEN
P6-06 Intelligence Aggregation → FROZEN
P6-07 Intelligence Presentation → IN PROGRESS
```

---

## 3. P6-07 Purpose

### What P6-07 IS

P6-07 is a **read-only presentation/consumption layer** that:

1. Exposes P6-03/04/05/06 artifacts through HTTP read APIs
2. Wires P6-04 regime and P6-05 warnings into the refresh pipeline
3. Presents P6 intelligence to users through deterministic UI components
4. Replaces legacy P3/P4/P5 presentation panels with P6-native equivalents

### What P6-07 IS NOT

- NOT a new intelligence calculation engine
- NOT a decision/action/BUY/SELL engine
- NOT historical comparison (P6-08)
- NOT cross-entity correlation (deferred)
- NOT warning delivery/push notifications
- NOT a P5 bridge or action layer
- NOT a replacement for P6-01…P6-06 semantics

---

## 4. P6-07 Scope

### In Scope

1. Read APIs for P6-03/04/05/06 artifacts
2. Refresh wiring for P6-04 regime + P6-05 warnings
3. Narrative dashboard presentation
4. Narrative detail presentation
5. Coin detail presentation
6. UI contract tests

### Out of Scope

- Historical comparison (P6-08)
- Cross-entity correlation (deferred)
- Warning delivery (separate concern)
- New intelligence calculations
- P4/P5 modifications

---

## 5. Explicit Non-Goals

| Non-Goal | Reason |
|---|---|
| Historical multi-window comparison | Deferred to P6-08 per PD-06A-03 |
| Cross-narrative correlation | No frozen contract |
| Warning push/email delivery | Product delivery concern |
| New health/regime/warning calculations | P6-01…P6-06 frozen |
| LLM-generated explanations | PD-06A-02 forbids LLM prose |
| BUY/SELL semantics | P6 boundary — never |
| P5 action execution | P6 boundary — never |

---

## 6. Presentation Architecture

```
/api/refresh
  ↓
P6-03 Snapshot
  ↓
P6-04 Regime ← P6-07A: wire here
  ↓
P6-05 Warning ← P6-07A: wire here
  ↓
P6-06 Summary ← P6-07A: wire here
  ↓
Persist
  ↓
/api/p6/* Read APIs ← P6-07: expose here
  ↓
UI Components ← P6-07: present here
  ↓
Narrative / Coin Pages
```

---

## 7. Authoritative P6 Inputs

| Input | Source | Authority | P6-07 Usage |
|---|---|---|---|
| Intelligence Snapshot | P6-03 | AUTHORITATIVE | Read API → UI |
| Regime State | P6-04 | AUTHORITATIVE | Read API → UI + refresh wiring |
| Warning Occurrences | P6-05 | AUTHORITATIVE | Read API → UI + refresh wiring |
| Intelligence Summary | P6-06 | AUTHORITATIVE | Read API → UI |
| QualityState | P6-01 | METADATA | Pass-through to UI |
| FreshnessState | P6-01 | METADATA | Pass-through to UI |

---

## 8. Read API Contract

### 8.1 Candidate Endpoints

| Endpoint | Purpose | Source | Identity |
|---|---|---|---|
| `GET /api/p6/summaries` | List current summaries | P6-06 | entity_type, entity_id |
| `GET /api/p6/summaries/[entityType]/[entityId]` | Current summary for entity | P6-06 | entity_type + entity_id |
| `GET /api/p6/snapshots/[entityType]/[entityId]` | Current snapshot for entity | P6-03 | entity_type + entity_id |
| `GET /api/p6/regime/[entityType]/[entityId]` | Current regime for entity | P6-04 | entity_type + entity_id |
| `GET /api/p6/warnings/[entityType]/[entityId]` | Current warnings for entity | P6-05 | entity_type + entity_id |

### 8.2 Response Contract

Every P6-07 read API response follows:

```typescript
interface P6ApiResponse<T> {
  success: boolean;
  data: T | null;
  error?: string;
  meta?: {
    entity_type: string;
    entity_id: number;
    window_end?: string; // ISO 8601
    version?: SummaryVersionTuple;
  };
}
```

### 8.3 Empty Response Semantics

- `data: null` when no authoritative P6 artifact exists
- No fabricated data
- No invented defaults
- `success: true` with `data: null` is valid

### 8.4 Not-Found Semantics

- Entity does not exist → `success: false, error: "Entity not found"`
- Entity exists but no P6 artifact → `success: true, data: null`

### 8.5 Latest Semantics

- Read APIs return only the CURRENT lifecycle artifact
- SUPERSEDED artifacts are never returned by default
- Historical browsing is deferred to P6-08

---

## 9. Presentation Model

### 9.1 Decision: PD-07B-01

**Question:** Should UI consume raw P6 artifacts, read DTOs, or dedicated presentation DTOs?

**Proposed:** P6 read DTOs (thin transformation layer). Not raw DB rows (too much noise), not heavy presentation models (risk of semantic drift).

**Rationale:** Read DTOs provide a clean API boundary while preserving P6 semantics. Presentation components consume DTOs, not database records.

### 9.2 DTO Definition

```typescript
// Narrative-level summary DTO
interface NarrativeIntelligenceDTO {
  entity_type: "narrative";
  entity_id: number;
  narrative_name: string;
  health_score: number | null;
  confidence: number | null;
  regime: RegimeState | null;
  warnings: WarningDTO[];
  summary: IntelligenceSummaryDTO | null;
  quality: QualityState;
  freshness: FreshnessState;
  window_end: string; // ISO 8601
  version: SummaryVersionTuple;
}

// Coin-level summary DTO
interface CoinIntelligenceDTO {
  entity_type: "coin";
  entity_id: number;
  coin_symbol: string;
  health_score: number | null;
  confidence: number | null;
  regime: RegimeState | null;
  warnings: WarningDTO[];
  summary: IntelligenceSummaryDTO | null;
  quality: QualityState;
  freshness: FreshnessState;
  window_end: string;
  version: SummaryVersionTuple;
}

// Explanation DTO (from P6-06)
interface IntelligenceSummaryDTO {
  what_changed: ExplanationItemDTO[];
  why: ExplanationItemDTO[];
  what_to_watch: ExplanationItemDTO[];
  health_delta: number | null;
  health_change_pct: number | null;
  regime_changed: boolean;
  new_warnings: WarningDTO[];
  resolved_warnings: WarningDTO[];
}

// Warning DTO (from P6-05, presentation-shaped)
interface WarningDTO {
  warning_id: number;
  warning_type: string;
  severity: string;
  lifecycle: string;
  detection_window: string;
  entity_type: string;
  entity_id: number;
}

// Explanation item DTO
interface ExplanationItemDTO {
  category: string;
  text: string;
  evidence_ref: string;
  severity: string | null;
}
```

---

## 10. Narrative Presentation

### 10.1 Narrative Dashboard View

| Section | Source | Authoritative? |
|---|---|---|
| Narrative name | Entity metadata | YES |
| Health score | P6-03 snapshot | YES |
| Confidence | P6-03 snapshot | YES |
| Regime | P6-04 regime state | YES |
| Active warnings count | P6-05 warnings | YES |
| Highest warning severity | P6-05 warnings | YES |
| Intelligence summary | P6-06 summary | YES |
| What changed | P6-06 explanation | YES |
| Quality indicator | P6-01 QualityState | METADATA |
| Freshness indicator | P6-01 FreshnessState | METADATA |

### 10.2 Narrative Detail View

| Section | Source | Authoritative? |
|---|---|---|
| Headline (health + regime) | P6-03 + P6-04 | YES |
| What changed | P6-06 explanation | YES |
| Why | P6-06 explanation | YES |
| What to watch | P6-06 explanation | YES |
| Regime details | P6-04 | YES |
| Warning list | P6-05 | YES |
| Member/mover context | P6-06 top-N movers | CONTEXT |
| Quality metadata | P6-01 | METADATA |
| Freshness metadata | P6-01 | METADATA |
| Provenance (collapsed) | P6-06 provenance | METADATA |

---

## 11. Coin Presentation

### 11.1 Coin Detail View

| Section | Source | Authoritative? |
|---|---|---|
| Coin symbol/name | Entity metadata | YES |
| Health score | P6-03 snapshot | YES |
| Confidence | P6-03 snapshot | YES |
| Regime | P6-04 regime state | YES |
| Active warnings | P6-05 warnings | YES |
| Intelligence summary | P6-06 summary | YES |
| What changed | P6-06 explanation | YES |
| Why | P6-06 explanation | YES |
| Narrative context | Parent narrative | CONTEXT |
| Quality metadata | P6-01 | METADATA |
| Freshness metadata | P6-01 | METADATA |

### 11.2 Coin/Narrative Symmetry

Coin and narrative presentation use identical DTO shapes and presentation patterns. The only difference is additional narrative context displayed on coin pages.

---

## 12. Refresh Wiring Contract

### 12.1 Decision: PD-07A-01 (CARRIED FORWARD)

**Question:** Should P6-07 wire P6-04/05 into the refresh pipeline?

**Proposed:** YES. After P6-03 snapshot generation, run:

```
P6-03 Snapshot (existing)
  ↓
P6-04 Regime Detection (NEW wiring)
  ↓
P6-05 Warning Detection (NEW wiring)
  ↓
P6-06 Aggregation (NEW wiring)
```

### 12.2 Sequencing Requirements

| Requirement | Value |
|---|---|
| P6-04 runs after P6-03 | REQUIRED |
| P6-05 runs after P6-03 | REQUIRED |
| P6-06 runs after P6-04 + P6-05 | REQUIRED |
| P6-04 failure → P6-05 still runs | YES (independent) |
| P6-05 failure → P6-06 still runs | YES (partial population) |
| P6-04+P6-05 failure → P6-06 skipped | YES (PD-06A-04: ≥1 input) |
| Global refresh failure on P6-04/05/06 | NO (PD-E2: never block refresh) |

### 12.3 Idempotency

- Repeated refresh produces deterministic results
- Same-window re-evaluation produces same artifacts
- No duplicate CURRENT artifacts

---

## 13. Failure / Partial Pipeline Semantics

| Failure | Impact | Behavior |
|---|---|---|
| P6-03 snapshot fails | P6-04/05/06 cannot run | Log error, skip P6-04→06 |
| P6-04 regime fails | P6-05 runs, P6-06 gets partial input | Log error, P6-06 uses available inputs |
| P6-05 warning fails | P6-04 runs, P6-06 gets partial input | Log error, P6-06 uses available inputs |
| P6-06 aggregation fails | Summary not generated | Log error, UI shows null summary |
| Read API fails | UI cannot display P6 data | Show fallback/empty state |
| All P6 layers fail | No P6 data available | UI shows "No P6 data" state |

**Key principle:** Infrastructure failure is NEVER converted into QualityState degradation.

---

## 14. Quality / Freshness Presentation

| Property | Presentation | Semantics Preserved |
|---|---|---|
| QualityState | Read-only indicator badge | ✅ quality ≠ freshness |
| FreshnessState | Read-only indicator badge | ✅ freshness ≠ quality |
| Infrastructure failure | NOT displayed as quality | ✅ infra ≠ data quality |
| Missing quality | Displayed as "Unknown" | ✅ no fabrication |

---

## 15. Warning Presentation

| Aspect | Value |
|---|---|
| Ordering | severity DESC → recency DESC → id ASC |
| Severity display | Color-coded badge (INFO/LOW/MEDIUM/HIGH/CRITICAL) |
| Lifecycle display | Current warnings only (DETECTED/ACTIVE) |
| Resolved warnings | Shown in "recently resolved" section |
| Occurrence identity | Warning ID displayed |
| Duplicate handling | Deduplicated by P6-05 |
| Cap | Max 10 warnings displayed |
| Empty state | "No active warnings" message |

---

## 16. Regime Presentation

| Aspect | Value |
|---|---|
| Current regime | Text badge (STRONG/STABLE/WEAK/TRANSITIONING) |
| Transitioning state | Animated indicator |
| Confidence | Percentage display |
| Timestamp | Last regime calculation time |
| INSUFFICIENT_DATA | "Insufficient data" message |
| UNKNOWN | "Unknown" message |
| Null/missing | "No regime data" message |

---

## 17. Intelligence Summary Presentation

| Aspect | Value |
|---|---|
| What changed | Ordered explanation items (max 10) |
| Why | Ordered explanation items (max 10) |
| What to watch | Ordered explanation items (max 10) |
| Health delta | Numeric display with color |
| Health change % | Percentage display with color |
| Regime changed | Boolean indicator |
| New warnings | List of new warning items |
| Resolved warnings | List of resolved warning items |
| Member context | Top-N movers (narrative only, context only) |

---

## 18. Provenance

P6-07 preserves upstream provenance:

| Source | Provenance Displayed |
|---|---|
| P6-03 snapshot | snapshot_id, window_end, version |
| P6-04 regime | regime_id, calculation_time, version |
| P6-05 warnings | warning_id, detection_window, version |
| P6-06 summary | summary_id, window_end, version, upstream refs |

Provenance is displayed in a collapsed "Technical Details" section.

---

## 19. Versioning

P6-07 does NOT create a new version tuple.

P6-07 reads and displays existing versions:

- P6-03: `p6-snapshot-v1`
- P6-04: `p6-regime-v1`
- P6-05: `p6-warning-v1`
- P6-06: `p6-summary-v1`

---

## 20. Latest / Historical Semantics

| Semantics | P6-07 Behavior |
|---|---|
| Latest | CURRENT lifecycle artifact returned |
| Historical | NOT implemented (deferred to P6-08) |
| Time-travel | NOT implemented |
| Backfill | NOT implemented |

---

## 21. Legacy UI Migration Audit

| Component | Classification | Reason |
|---|---|---|
| `P3IntelligencePanel` | **RETIRE** | Legacy P3 data source |
| `P4DecisionSupportPanel` | **RETIRE** | Legacy P4 data source |
| `P5ActionDecisionPanel` | **RETIRE** | Legacy P5 data source |
| `HealthBadge` | **REUSE** | Presentation-only, no intelligence semantics |
| `ScoreChange` | **REUSE** | Presentation-only, delta display |
| `ConfidenceBadge` | **REUSE** | Presentation-only, confidence display |
| `CoinRankingTable` | **ADAPT** | Needs P6 data source |
| `CorrelationHeatmap` | **DEFER** | Cross-entity, P6-08 scope |
| `HealthTimeline` | **ADAPT** | Needs P6 snapshot data source |
| Legacy narrative-health | **DO NOT USE** | Legacy calculation |
| `NarrativeCard` | **ADAPT** | Needs P6 summary data source |
| `SourceStatusBar` | **REUSE** | Presentation-only |

---

## 22. P4 Boundary Audit

| Check | Result |
|---|---|
| P4 unchanged | ✅ |
| P4 semantic outputs not reinterpreted | ✅ |
| No action/policy leakage | ✅ |
| No decision semantics introduced | ✅ |
| Legacy P4 panels retired | ✅ |

---

## 23. P5 Boundary / Replay Audit

| Check | Result |
|---|---|
| P5 unchanged | ✅ |
| P5 replay unchanged | ✅ |
| P5 decisions not recomputed | ✅ |
| P6-07 not a P5 bridge | ✅ |
| No action semantics | ✅ |
| No BUY/SELL semantics | ✅ |
| Legacy P5 panels retired | ✅ |

---

## 24. Explicit Decision Inventory

Decisions inherited from frozen P6 contracts:

| Decision | Source | P6-07 Impact |
|---|---|---|
| PD-06A-01 | P6-06 | Summary scope defined; P6-07 consumes it |
| PD-06A-02 | P6-06 | Explanation format defined; P6-07 renders it |
| PD-06A-03 | P6-06 | Two-point change detection; P6-07 displays deltas |
| PD-06A-04 | P6-06 | Empty population; P6-07 handles gracefully |
| PD-06C-01 | P6-06 | window_end deterministic; P6-07 displays it |
| PD-07A-01 | P6-07A | Refresh wiring (carried forward) |
| PD-07A-02 | P6-07A | Read API design (carried forward) |
| PD-07A-03 | P6-07A | Legacy panel retirement (carried forward) |

---

## 25. New Decision Inventory

| ID | Question | Proposed | Status | Blocking |
|---|---|---|---|---|
| **PD-07B-01** | Presentation model: raw/DTO/presentation DTO? | Read DTOs (thin transformation) | PROPOSED | No |
| **PD-07B-02** | Should narrative and coin DTOs be symmetric? | YES — identical shapes | PROPOSED | No |
| **PD-07B-03** | Should "technical details" be collapsible? | YES — provenance/version in collapsible | PROPOSED | No |
| **PD-07B-04** | Should empty P6 state show fallback or hide section? | Show "No P6 data" fallback | PROPOSED | No |
| **PD-07B-05** | Should warnings display resolved items? | Yes, in separate "recently resolved" section | PROPOSED | No |
| **PD-07B-06** | Should regime transitioning use animation? | YES — visual indicator | PROPOSED | No |
| **PD-07B-07** | Should P6-07 create its own persistence? | NO — read-only, no new tables | PROPOSED | No |
| **PD-07B-08** | Should refresh wiring be optional/configurable? | YES — P6-04/05/06 wiring can be disabled | PROPOSED | No |

---

## 26. Blocking Decisions

| ID | Question | Why Blocking | Downstream |
|---|---|---|---|
| PD-07A-01 | Refresh wiring for P6-04/05 | Without wiring, P6-04/05 never run; P6-06 has no input | All P6-07 presentation |
| PD-07A-02 | Read API design | UI cannot consume P6 artifacts without APIs | All UI components |
| PD-07A-03 | Legacy panel retirement | Determines whether P6-07 replaces or supplements legacy UI | All UI migration |

---

## 27. Non-Blocking Decisions

| ID | Question | Default |
|---|---|---|
| PD-07B-01 | Presentation model | Read DTOs |
| PD-07B-02 | Coin/narrative symmetry | Identical shapes |
| PD-07B-03 | Technical details | Collapsible |
| PD-07B-04 | Empty state handling | "No P6 data" fallback |
| PD-07B-05 | Resolved warnings display | Separate section |
| PD-07B-06 | Regime animation | Visual indicator |
| PD-07B-07 | P6-07 persistence | No new tables |
| PD-07B-08 | Refresh wiring configurability | Optional/configurable |

---

## 28. Deferred Decisions

| Item | Reason |
|---|---|
| Historical comparison | P6-08 scope |
| Cross-entity correlation | No frozen contract |
| Warning delivery mechanism | Product concern |
| Access control / auth changes | Outside P6-07 scope |

---

## 29. Proposed Invariants

| ID | Statement | Class |
|---|---|---|
| **PV-01** | P6-07 consumes only P6-native artifacts | Boundary |
| **PV-02** | P6-07 does not recalculate health/regime/warning semantics | Boundary |
| **PV-03** | P6-07 is read-only (no mutation of P6 artifacts) | Boundary |
| **PV-04** | P6-07 output is deterministic for same inputs | Semantic |
| **PV-05** | Read API identity matches P6 artifact identity | Semantic |
| **PV-06** | Read APIs return only CURRENT lifecycle artifacts | Semantic |
| **PV-07** | Empty P6 state returns null, not fabricated data | Semantic |
| **PV-08** | Provenance is preserved in presentation | Semantic |
| **PV-09** | QualityState and FreshnessState remain independent | Semantic |
| **PV-10** | P4 is untouched by P6-07 | Boundary |
| **PV-11** | P5 is untouched by P6-07 | Boundary |
| **PV-12** | P6-07 contains no action semantics | Boundary |
| **PV-13** | P6-07 contains no BUY/SELL semantics | Boundary |
| **PV-14** | P6-07 contains no legacy contamination | Boundary |
| **PV-15** | Refresh wiring preserves dependency ordering | Semantic |
| **PV-16** | Partial pipeline failure does not block refresh | Semantic |
| **PV-17** | Infrastructure failure is never QualityState degradation | Semantic |
| **PV-18** | Explanation arrays are always present (may be empty) | Semantic |

---

## 30. Evidence Gaps

| Gap | Blocking? | Impact |
|---|---|---|
| P6-04/05 refresh wiring not implemented | **YES** | Pipeline incomplete |
| No P6 read APIs exist | **YES** | UI cannot consume P6 artifacts |
| No P6 summary data in production | No | P6-07 must handle empty state |
| Legacy UI pages use hardcoded legacy sources | No | P6-07 replaces, not adapts |
| P6 snapshot read APIs are internal only | No | P6-07 exposes via HTTP |

---

## 31. Dependency Graph

```
PD-07A-01 (Refresh wiring)
    ↓
PD-07A-02 (Read APIs)
    ↓
PD-07A-03 (Legacy retirement)
    ↓
PD-07B-01 (Presentation model)
    ↓
P6-07B — Semantic Contract ← YOU ARE HERE
    ↓
P6-07C — Decision Inventory + Gap Audit
    ↓
P6-07C1 — Focused Planner Decision Contract
    ↓
Planner Acceptance
    ↓
P6-07D — Implementation
    ↓
P6-07E — Hardening + Freeze Audit
    ↓
P6-07-FINAL — Freeze Declaration
```

---

## 32. Recommended V1 Presentation Scope

P6-07 V1 should contain:

1. **Refresh wiring** — P6-04 regime + P6-05 warnings + P6-06 aggregation after P6-03
2. **Read APIs** — `/api/p6/*` endpoints
3. **Read DTOs** — Thin transformation layer
4. **Narrative dashboard** — P6-06 summary + regime + warnings
5. **Narrative detail** — Full P6-06 explanation + upstream artifacts
6. **Coin detail** — P6-03 snapshot + P6-04 regime + P6-05 warnings
7. **UI contract tests** — Verify no BUY/SELL/action semantics

---

## 33. Recommended Execution Sequence

```
P6-07A  Landscape Recon ← COMPLETE
  ↓
P6-07B  Semantic Contract ← YOU ARE HERE
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

## 34. Readiness Verdict

```
READY FOR P6-07C
```

3 blocking decisions identified (all carried from P6-07A). 8 new decisions proposed. 18 invariants proposed. All have clear proposed resolutions. The contract is architecturally sound and boundary-safe.

---

## 35. Git Boundary

| Check | Result |
|---|---|
| Only documentation file changed | ✅ PASS |
| No production code modified | ✅ PASS |
| No frozen contracts modified | ✅ PASS |
| P4/P5 untouched | ✅ PASS |
| Working tree clean after commit | ✅ PASS |
