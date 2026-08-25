# P6-06A — Intelligence Aggregation Landscape Recon

## 1. Executive Summary

P6-06 is the **Intelligence Aggregation & Explainability** layer — the mechanism that combines P6-03 snapshots, P6-04 regimes, and P6-05 warnings into a coherent intelligence view with plain-language explanations.

**Key findings:**

- **10 explicit decisions** discovered
- **8 implicit decisions** discovered
- **4 blocking decisions** (aggregation method, explanation scope, temporal window, minimum population)
- **6 non-blocking decisions** (with safe V1 defaults)
- **3 deferred decisions** (outside P6-06 scope)
- **8 evidence gaps** (1 blocking — production explanation quality needs user validation)
- **12 reusable components** (P6-01…05 frozen modules)
- **2 components needing adaptation** (legacy dashboard, legacy narrative health)
- **3 legacy components rejected** (P3 intelligence, P4 explanation templates, legacy narrative health calculation)
- **0 frozen contracts modified**

**P6-06 scope:** Coherent intelligence view + plain-language explanation. NOT a decision engine, NOT a BUY/SELL signal generator, NOT a P5 bridge.

---

## 2. Current P6 Pipeline State

| Phase | Scope | Status | Artifacts |
|---|---|---|---|
| P6-01 | Observation/Quality | ✅ FROZEN | Canonical observations, quality metadata |
| P6-02 | Derived Features | ✅ FROZEN | Health dimensions, health_score, confidence |
| P6-03 | Intelligence Snapshot | ✅ FROZEN | Coin/narrative snapshots with health_score, quality, freshness |
| P6-04 | Trend/Regime | ✅ FROZEN | Regime states (STRONG/STABLE/WEAK/TRANSITIONING), confidence |
| P6-05 | Early Warning | ✅ FROZEN | Structured warnings with severity, dedup, lifecycle |
| **P6-06** | **Intelligence Aggregation** | **← THIS** | **Coherent view + explanations** |
| P6-07 | UI/Dashboard | Not started | — |

---

## 3. P6-06 Purpose

### What Problem Does P6-06 Solve?

P6-01 through P6-05 produce rich but fragmented intelligence:
- **P6-03**: "Bitcoin's health score is 72" (isolated number)
- **P6-04**: "Bitcoin is STABLE" (regime classification)
- **P6-05**: "Bitcoin's health deteriorated by 12 points" (single warning)

None of these alone answer the user's core questions:
1. **"What changed?"** — across health, regime, warnings
2. **"Why?"** — causal chain from observations to current state
3. **"What should I watch?"** — prioritized attention items

P6-06 synthesizes these fragmented signals into a coherent, explainable intelligence summary.

### What Is "Intelligence Aggregation"?

Intelligence aggregation is the process of:
1. **Collecting** P6-03 snapshots, P6-04 regimes, and P6-05 warnings for an entity
2. **Synthesizing** them into a unified intelligence state
3. **Explaining** what changed, why, and what to watch
4. **Producing** a structured output artifact for P6-07 (UI) consumption

### Why P6-03/P6-04/P6-05 Alone Are Insufficient

| Artifact | What It Says | What It Doesn't Say |
|---|---|---|
| P6-03 Snapshot | Health score = 72 | Why 72, what changed, what's the regime |
| P6-04 Regime | STABLE | What warnings exist, what's the health trend |
| P6-05 Warning | Health dropped 12 points | What's the current regime, is this part of a pattern |

P6-06 bridges these gaps by producing a **coherent view**.

---

## 4. P6-06 Scope

### In Scope (V1)

| Capability | Description |
|---|---|
| **Intelligence Summary** | Unified state: health + regime + warnings for an entity |
| **Change Detection** | What changed since the last evaluation |
| **Explanation Generation** | Plain-language "what changed", "why", "what to watch" |
| **Provenance** | Full traceability from explanation → warning → regime → snapshot → observation |
| **Coin + Narrative** | Same model for both entity types |

### Explicit Non-Goals

| Non-Goal | Reason |
|---|---|
| BUY/SELL signals | P6 observes, P5 decides |
| Action recommendations | P6 observes, P5 acts |
| Policy triggers | P5 scope |
| Trading signals | Out of scope |
| Historical backfill | P6-08 scope |
| Cross-entity correlation | V2 scope |
| User acknowledgement | V2 scope |
| Alert/notification delivery | P6-07 scope |

---

## 5. Architecture Recon

### 5.1 Upstream Artifacts

| Artifact | Source | Location | Identity | Version | Lifecycle |
|---|---|---|---|---|---|
| Coin Snapshot | P6-03 | p6_snapshots | (entity_type, entity_id, snapshot_type, window_end) | SnapshotVersionTuple | CURRENT/SUPERSEDED |
| Narrative Snapshot | P6-03 | p6_snapshots | Same as coin | SnapshotVersionTuple | CURRENT/SUPERSEDED |
| Regime State | P6-04 | p6_regime_states | (entity_type, entity_id, regime_type, status) | RegimeVersionTuple | CURRENT/SUPERSEDED |
| Warning | P6-05 | p6_warnings | (entity_type, entity_id, warning_type, detection_window) | WarningVersionTuple | DETECTED/ACTIVE/RESOLVED/SUPERSEDED |

### 5.2 Data Flow

```
P6-01 Observation → P6-02 Feature → P6-03 Snapshot → P6-04 Regime → P6-05 Warning
                                                                              ↓
                                                               P6-06 Intelligence Summary
                                                                              ↓
                                                               P6-07 UI / Dashboard
```

### 5.3 Read APIs (Existing)

| Module | Function | Returns |
|---|---|---|
| P6-03 snapshot/persistence | `readCurrentSnapshot()` | Latest CURRENT snapshot |
| P6-04 regime/persistence | `readCurrentRegime()` | Latest CURRENT regime |
| P6-05 warning/persistence | `readActiveWarnings()` | All ACTIVE warnings |
| P6-05 warning/persistence | `readWarningHistory()` | Historical warnings |

---

## 6. Authoritative Input Inventory

| Input | Source | Classification | Notes |
|---|---|---|---|
| Health score | P6-03 snapshot | AUTHORITATIVE | Current health score |
| Health dimensions | P6-03 snapshot | AUTHORITATIVE | Trend, momentum, volume, derivative |
| Confidence score | P6-03 snapshot | AUTHORITATIVE | Data completeness |
| Regime state | P6-04 regime | AUTHORITATIVE | STRONG/STABLE/WEAK/TRANSITIONING |
| Regime confidence | P6-04 regime | AUTHORITATIVE | Classification confidence |
| Warnings | P6-05 warnings | AUTHORITATIVE | Active warnings with severity |
| Warning history | P6-05 warnings | AUTHORITATIVE | Historical warnings |
| Quality metadata | P6-03 snapshot | AUTHORITATIVE | VALID/INVALID/MISSING/UNKNOWN |
| Freshness metadata | P6-03 snapshot | AUTHORITATIVE | FRESH/STALE/UNKNOWN |
| Previous snapshot | P6-03 persistence | AUTHORITATIVE | For change detection |
| Previous regime | P6-04 persistence | AUTHORITATIVE | For change detection |
| Coin metadata | coins table | READ-ONLY | Name, symbol, market_cap |
| Narrative metadata | narratives table | READ-ONLY | Name, description |
| Legacy P3 intelligence | P3 tables | DO NOT USE | Semantically incompatible |
| Legacy P4 explanation | P4 templates | DO NOT USE | P3-era, not P6-native |
| Legacy narrative health | narrativeHealth table | DO NOT USE | P3-era calculation |

---

## 7. Aggregation Candidate Models

### 7.1 What Aggregation Means for P6-06

P6-06 aggregation is NOT mathematical aggregation (that's P6-02/P6-03). P6-06 aggregation is **synthesis** — combining disparate signals into a coherent narrative.

### 7.2 Candidate: Narrative Summary

```typescript
interface NarrativeIntelligenceSummary {
  entity_type: "coin" | "narrative";
  entity_id: number;
  
  // Current state (from P6-03/P6-04)
  health_score: number;
  regime_state: RegimeState;
  regime_confidence: number;
  
  // Active warnings (from P6-05)
  active_warnings: WarningSummary[];
  warning_count: number;
  highest_severity: Severity | null;
  
  // Change summary
  health_change: ChangeSummary;
  regime_change: ChangeSummary;
  new_warnings: WarningSummary[];
  resolved_warnings: WarningSummary[];
  
  // Explanation
  what_changed: string[];
  why: string[];
  what_to_watch: string[];
  
  // Provenance
  provenance: SummaryProvenance;
  version: SummaryVersionTuple;
  calculated_at: Date;
}
```

---

## 8. Coin Aggregation

### V1 Scope

For coins, P6-06 produces a **Coin Intelligence Summary** by combining:
- Current P6-03 coin snapshot (health_score, dimensions)
- Current P6-04 regime state
- Active P6-05 warnings

No cross-coin aggregation in V1 (that's P6-06 narrative scope).

### Change Detection

Compare current vs previous:
- Health score delta
- Regime state change
- New/resolved warnings

---

## 9. Narrative Aggregation

### V1 Scope

For narratives, P6-06 produces a **Narrative Intelligence Summary** by combining:
- Current P6-03 narrative snapshot (health_score, member scores)
- Current P6-04 narrative regime
- Active P6-05 narrative warnings
- Member coin summaries (for "what to watch")

### Narrative-Specific Considerations

| Consideration | V1 Approach |
|---|---|
| Member coin summaries | Include top N coins by health change |
| Cross-entity warnings | Show narrative warnings + member coin warnings |
| Membership changes | Not in V1 (P6-08 scope) |
| Historical comparison | Not in V1 (P6-08 scope) |

---

## 10. Quality / Freshness Semantics

| Aspect | P6-06 Behavior |
|---|---|
| Quality is metadata | ✅ Preserved in summary provenance |
| Quality is NOT used for aggregation | ✅ Quality doesn't affect summary generation |
| Freshness is metadata | ✅ Preserved in summary provenance |
| Freshness is NOT used for aggregation | ✅ Freshness doesn't affect summary generation |
| No new QualityState | ✅ |
| No new FreshnessState | ✅ |
| Infrastructure failure ≠ quality | ✅ |

---

## 11. Missing / Invalid / UNKNOWN Handling

| Scenario | P6-06 Behavior |
|---|---|
| Missing snapshot | Summary marked as "data unavailable" |
| Invalid snapshot | Summary uses last known valid state |
| UNKNOWN quality | Summary preserved, quality metadata noted |
| Missing regime | Regime shown as "unknown" |
| Missing warnings | Warning list empty |
| All inputs missing | Summary marked as "insufficient data" |

---

## 12. Warning Aggregation

### How Warnings Feed Into Summary

P6-06 does NOT aggregate warnings mathematically. It:
1. Counts active warnings
2. Identifies highest severity
3. Lists recent changes (new/resolved)
4. Generates "what to watch" from high-severity warnings

### Warning Summary Structure

```typescript
interface WarningSummary {
  warning_type: WarningType;
  severity: Severity;
  message: string;
  detected_at: Date;
  health_delta: number | null;
  regime_state: string | null;
}
```

---

## 13. Regime Aggregation

### How Regime Feeds Into Summary

P6-06 reads the current regime state and confidence. It:
1. Includes regime state in summary
2. Detects regime changes (compare previous)
3. Generates "why" explanations from regime transitions

---

## 14. Provenance

### Summary Provenance Chain

```
Intelligence Summary
  → P6-05 Warnings (active)
    → P6-04 Regime State
      → P6-03 Snapshot
        → P6-02 Features
          → P6-01 Observations
```

### Minimum Provenance

- Source layer: "P6-06"
- Entity identity
- Input snapshot IDs
- Input regime identity
- Input warning IDs
- Calculation timestamp
- Version tuple
- Quality/freshness metadata

---

## 15. Versioning

### Summary Version Tuple

```typescript
interface SummaryVersionTuple {
  algorithm_version: string;    // "p6-summary-v1"
  parameter_version: string;    // explanation config version
  schema_version: string;       // "v1"
  config_hash: string;          // hash of active configuration
}
```

### Separation

P6-06 version is standalone from:
- P6-02 feature version
- P6-03 snapshot version
- P6-04 regime version
- P6-05 warning version

---

## 16. Persistence

### V1 Persistence Model

| Option | Assessment |
|---|---|
| New `p6_intelligence_summaries` table | Recommended — consistent with P6 pattern |
| Latest-only semantics | YES — only current summary per entity |
| Historical summaries | DEFERRED — P6-08 scope |
| Append-only | NO — latest-only with supersession |

### Schema (Proposed)

| Column | Type | Purpose |
|---|---|---|
| id | serial PK | Unique identifier |
| entity_type | varchar(20) | "coin" \| "narrative" |
| entity_id | integer | Entity identifier |
| health_score | real | Current health score |
| regime_state | varchar(30) | Current regime |
| regime_confidence | real | Regime confidence |
| active_warning_count | integer | Number of active warnings |
| highest_severity | varchar(20) | Highest warning severity |
| what_changed | jsonb | Change summary |
| why | jsonb | Explanation of changes |
| what_to_watch | jsonb | Attention items |
| quality_metadata | jsonb | Quality snapshot |
| freshness_metadata | jsonb | Freshness snapshot |
| provenance | jsonb | Full provenance chain |
| algorithm_version | text | Version tuple |
| parameter_version | text | Version tuple |
| schema_version | text | Version tuple |
| config_hash | text | Version tuple |
| status | varchar(20) | CURRENT \| SUPERSEDED |
| calculated_at | timestamp | When summary was generated |
| created_at | timestamp | Record creation |

---

## 17. Lifecycle

| State | Meaning |
|---|---|
| CURRENT | Active, latest summary for entity |
| SUPERSEDED | Replaced by newer summary |

Summary lifecycle is independent from:
- Warning lifecycle (DETECTED/ACTIVE/RESOLVED/SUPERSEDED)
- Regime status (CURRENT/SUPERSEDED)
- Snapshot status (CURRENT/SUPERSEDED)

---

## 18. Legacy Reuse Audit

### Reusable Components

| Component | File | Why Reusable |
|---|---|---|
| P6-03 snapshot persistence | `src/lib/p6/snapshot/persistence.ts` | Read current snapshots |
| P6-04 regime persistence | `src/lib/p6/regime/persistence.ts` | Read current regimes |
| P6-05 warning persistence | `src/lib/p6/warning/persistence.ts` | Read active warnings |
| P6-05 warning types | `src/lib/p6/warning/types.ts` | WarningType, Severity |
| P6-04 regime types | `src/lib/p6/regime/types.ts` | RegimeState |
| P6-03 snapshot types | `src/lib/p6/snapshot/types.ts` | SnapshotIdentity |
| P6-05 provenance pattern | `src/lib/p6/warning/provenance.ts` | Assembly pattern |
| P6-04 provenance pattern | `src/lib/p6/regime/provenance.ts` | Assembly pattern |
| P6-05 engine pattern | `src/lib/p6/warning/engine.ts` | Orchestration pattern |
| Schema conventions | `src/db/schema.ts` | Table/index patterns |
| Drizzle ORM patterns | Throughout P6 | DB access patterns |

### Components Needing Adaptation

| Component | File | Adaptation Needed |
|---|---|---|
| Dashboard route | `src/app/api/dashboard/route.ts` | Currently reads legacy P3 narrativeHealth. Should eventually read P6-06 summaries. Not modified in P6-06. |
| Narrative health API | `src/app/api/narratives/[id]/route.ts` | Currently reads legacy narrativeHealth. Should eventually read P6-06. Not modified in P6-06. |

### Legacy Components Rejected

| Component | File | Why Not |
|---|---|---|
| P3 intelligence service | `src/lib/services/p3-intelligence.service.ts` | P3-era, semantically incompatible |
| P4 explanation templates | `src/lib/p4/explanation/templates.ts` | P3-era templates, not P6-native |
| Legacy narrative health | `src/lib/scoring/narrative-health.ts` | P3-era calculation, different algorithm |
| Legacy narrativeHealth table | `src/db/schema.ts` | P3-era persistence, different schema |

---

## 19. P4 Boundary Audit

| Check | Result |
|---|---|
| P6-06 does NOT modify P4 | ✅ |
| P6-06 does NOT consume P4 output | ✅ |
| P6-06 does NOT produce P4 input | ✅ (P6-07 is the UI layer) |
| P6-06 does NOT reinterpret P4 decisions | ✅ |
| P4 remains untouched | ✅ |

---

## 20. P5 Boundary / Replay Audit

| Check | Result |
|---|---|
| P6-06 does NOT modify P5 | ✅ |
| P6-06 does NOT produce BUY/SELL | ✅ |
| P6-06 does NOT produce action semantics | ✅ |
| P6-06 does NOT produce policy semantics | ✅ |
| P6-06 does NOT contaminate P5 replay | ✅ |
| P6-06 does NOT reinterpret QualityState | ✅ |
| P5 remains untouched | ✅ |

---

## 21. Explicit Decision Inventory

### PD-06A-01: Summary Scope
**Question:** What does the intelligence summary contain?
**Proposed:** Health score + regime + warnings + change summary + explanations
**Blocking:** YES
**Dependencies:** None

### PD-06A-02: Explanation Format
**Question:** What format do explanations use?
**Proposed:** Structured arrays: what_changed[], why[], what_to_watch[]
**Blocking:** YES
**Dependencies:** PD-06A-01

### PD-06A-03: Change Detection Window
**Question:** How far back do we compare for change detection?
**Proposed:** Previous snapshot only (1-day lookback)
**Blocking:** YES
**Dependencies:** PD-06A-01

### PD-06A-04: Minimum Population
**Question:** What's the minimum data required to generate a summary?
**Proposed:** At least 1 of: snapshot, regime, or warnings must exist
**Blocking:** YES
**Dependencies:** PD-06A-01

### PD-06A-05: Coin vs Narrative Model
**Question:** Same model for coins and narratives?
**Proposed:** YES — same model, entity_type as parameter
**Blocking:** NO — safe default
**Dependencies:** None

### PD-06A-06: Warning Display Threshold
**Question:** Which warnings appear in summary?
**Proposed:** All ACTIVE warnings (no severity filter)
**Blocking:** NO — safe default
**Dependencies:** PD-06A-01

### PD-06A-07: Persistence Model
**Question:** Latest-only or historical?
**Proposed:** Latest-only (CURRENT/SUPERSEDED)
**Blocking:** NO — safe default
**Dependencies:** PD-06A-01

### PD-06A-08: Summary Refresh Timing
**Question:** When is the summary recalculated?
**Proposed:** Synchronous after P6-05 warning generation
**Blocking:** NO — safe default
**Dependencies:** PD-06A-01

### PD-06A-09: Provenance Depth
**Question:** How deep does provenance trace?
**Proposed:** Full chain (summary → warning → regime → snapshot → feature → observation)
**Blocking:** NO — safe default
**Dependencies:** None

### PD-06A-10: Version Tuple
**Question:** What's in the summary version tuple?
**Proposed:** Standalone (algorithm_version, parameter_version, schema_version, config_hash)
**Blocking:** NO — safe default
**Dependencies:** None

---

## 22. Implicit Decision Inventory

| ID | Question | Proposed | Blocking |
|---|---|---|---|
| PD-06A-11 | How are "what changed" items ranked? | By severity (highest first), then by recency | NO |
| PD-06A-12 | How are "why" explanations generated? | Template-based from regime transitions + warning triggers | NO |
| PD-06A-13 | How are "what to watch" items selected? | HIGH/CRITICAL severity warnings + regime transitions | NO |
| PD-06A-14 | Can summary exist without warnings? | YES — summary shows health + regime only | NO |
| PD-06A-15 | Can summary exist without regime? | YES — summary shows health + warnings only | NO |
| PD-06A-16 | Can summary exist without snapshot? | PARTIAL — summary marked as "data unavailable" | NO |
| PD-06A-17 | How is "data unavailable" displayed? | health_score=null, regime="UNKNOWN", explanation="Insufficient data" | NO |
| PD-06A-18 | What happens when all inputs are stale? | Summary preserved with freshness metadata noting staleness | NO |

---

## 23. Blocking Decisions

| ID | Question | Why Blocking |
|---|---|---|
| PD-06A-01 | Summary scope | Determines what P6-06 produces |
| PD-06A-02 | Explanation format | Determines output structure for P6-07 |
| PD-06A-03 | Change detection window | Determines what "changed" means |
| PD-06A-04 | Minimum population | Determines when summary is generated vs skipped |

---

## 24. Non-Blocking Decisions (Safe Defaults)

| ID | Decision | V1 Default |
|---|---|---|
| PD-06A-05 | Coin/narrative parity | Same model |
| PD-06A-06 | Warning display threshold | All ACTIVE warnings |
| PD-06A-07 | Persistence model | Latest-only |
| PD-06A-08 | Refresh timing | Synchronous after P6-05 |
| PD-06A-09 | Provenance depth | Full chain |
| PD-06A-10 | Version tuple | Standalone |

---

## 25. Deferred Decisions

| ID | Decision | Reason |
|---|---|---|
| PD-06A-19 | Historical summary comparison | P6-08 scope |
| PD-06A-20 | Cross-entity correlation | V2 scope |
| PD-06A-21 | User acknowledgement workflow | V2 scope |

---

## 26. Evidence Gaps

| Gap | Impact | Blocking | Resolution |
|---|---|---|---|
| Explanation quality needs user validation | Affects "what to watch" relevance | NO — safe defaults | Needs production feedback |
| Production warning volume affects summary density | Affects "what to watch" noise | NO | Needs production data |
| Narrative membership changes affect summary | Not in V1 | NO | P6-08 scope |
| Historical comparison needed for "trend" explanations | Affects "why" depth | NO — V1 uses single snapshot | P6-08 scope |
| P6-07 UI contract undefined | Affects output format | NO — V1 uses structured JSON | P6-07 scope |
| Legacy dashboard migration path | Affects consumer transition | NO — additive, not replacement | P6-07 scope |
| Explanation template testing | Affects quality | NO — deterministic templates | Implementation phase |
| Minimum summary population threshold | Affects when summaries appear | NO — safe default: 1 input required | Implementation phase |

---

## 27. Dependency Graph

```
PD-06A-01 (Summary scope)
    ↓
PD-06A-02 (Explanation format)
    ↓
PD-06A-11 (Change ranking)
PD-06A-12 (Why generation)
PD-06A-13 (What to watch)
    ↓
PD-06A-03 (Change detection window)
    ↓
PD-06A-04 (Minimum population)
    ↓
PD-06A-07 (Persistence model)
    ↓
p6_intelligence_summaries schema
    ↓
PD-06A-08 (Refresh timing)
    ↓
Refresh integration
```

### Independent Decisions

- PD-06A-05 (coin/narrative parity) — standalone
- PD-06A-09 (provenance depth) — standalone
- PD-06A-10 (version tuple) — standalone

---

## 28. Recommended V1 Scope

### What P6-06 V1 Produces

For each entity (coin or narrative):

1. **Intelligence Summary** — unified state object
2. **Change Summary** — what changed since last evaluation
3. **Explainability** — "what changed", "why", "what to watch"
4. **Provenance** — full traceability
5. **Persistence** — latest-only in `p6_intelligence_summaries`

### What P6-06 V1 Does NOT Produce

- Historical comparison (P6-08)
- Cross-entity correlation (V2)
- User acknowledgement (V2)
- Notification delivery (P6-07)
- BUY/SELL signals (never)
- Action recommendations (never)

---

## 29. Recommended Execution Sequence

```
P6-06A  ← THIS (Landscape Recon)
   ↓
P6-06B  (Semantic Contract)
   ↓
P6-06C  (Decision Inventory & Gap Audit)
   ↓
P6-06C1 (Focused Planner Decision Contract)
   ↓
PLANNER FREEZE (4 blocking decisions)
   ↓
P6-06D  (Implementation)
   ↓
P6-06E  (Hardening & Freeze Audit)
   ↓
P6-06-FINAL (Freeze Declaration)
```

---

## 30. Readiness Verdict

**READY FOR P6-06B**

- P6-01 through P6-05 all frozen ✅
- P6-06 scope objectively established ✅
- Authoritative inputs identified ✅
- Aggregation semantics mapped ✅
- Coin/narrative semantics analyzed ✅
- Missing/invalid/UNKNOWN behavior identified ✅
- Warning/regime aggregation identified ✅
- Provenance/version/lifecycle requirements identified ✅
- Legacy contamination audited ✅
- P4/P5 boundary audited ✅
- Explicit + implicit decisions inventoried ✅
- Blocking decisions identified (4) ✅
- Evidence gaps identified ✅
- Dependency graph documented ✅
- V1 scope proposed ✅
- No production code changed ✅
- No frozen contract changed ✅

---

## 31. Git Boundary

- Only documentation changed
- No production code
- No schema changes
- No P4/P5 changes
- No P6-01/02/03/04/05 changes
- Working tree clean after commit
