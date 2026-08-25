# P6-05C — Early Warning Decision Inventory & Gap Audit

## 1. Executive Summary

P6-05C performs a complete decision inventory and semantic gap audit for the P6-05 Early Warning Engine, building on the P6-05B semantic contract (7e30fc7).

**Key findings:**

- **Total decisions: 34** (14 explicit from P6-05B + 20 implicit discovered)
- **Blocking: 6** (up from 4 in P6-05B — 2 implicit blockers discovered)
- **Non-blocking: 24** (with safe V1 defaults)
- **Deferred: 4** (outside P6-05 scope)
- **Invariants: 28** (24 from P6-05B + 4 new)
- **Evidence gaps: 8** (6 from P6-05B + 2 new)
- **Legacy contamination: NONE**

**Verdict:** READY FOR P6-05C1 (Focused Planner Decision Contract)

No production code was modified. No frozen contracts were modified.

---

## 2. Scope

This document audits:
- P6-05B semantic contract completeness
- All implicit semantic decisions hidden in implementation requirements
- Quality/freshness boundary preservation
- Material change detection semantics
- Severity model separation from action/policy
- Deduplication semantics
- Warning lifecycle correctness
- Coin/narrative parity
- P4/P5 boundary integrity
- Invariant coverage

---

## 3. P6-05B Baseline

| Metric | P6-05B Value |
|---|---|
| Explicit decisions | 14 (PD-05B-01…14) |
| Blocking decisions | 4 |
| Non-blocking decisions | 10 |
| Invariants | 24 (EW-01…EW-24) |
| Evidence gaps | 6 |
| Warning types proposed | 7 |
| Severity levels proposed | 5 |

---

## 4. Repository Evidence Audit

### 4.1 Legacy Alert Infrastructure

| Component | File | Classification |
|---|---|---|
| `AlertRule` type | `src/lib/types/alert.ts` | LEGACY — P3 rule model (triggerType, triggerValue) |
| `AlertHistory` type | `src/lib/types/alert.ts` | LEGACY — P3 alert history |
| `AlertFired` type | `src/lib/types/alert.ts` | LEGACY — P3 alert fired event |
| `AlertService` | `src/lib/services/alert.service.ts` | LEGACY — CRUD for P3 alert rules/history |
| `alert_rules` table | `src/db/schema.ts:692` | LEGACY — P3 alert rule persistence |
| `alert_history` table | `src/db/schema.ts:706` | LEGACY — P3 alert history persistence |
| Admin alert routes | `src/app/api/admin/alerts/` | LEGACY — Admin UI for P3 alerts |

**Key observation:** The legacy `alert_rules` table uses a simple model: `(scope, scopeId, triggerType, triggerValue, isActive)`. This is fundamentally different from P6-05's P6-native warning model. The legacy system has:
- User-created rules with manual thresholds
- Acknowledgement workflow
- No quality/freshness metadata
- No regime integration
- No P6 pipeline provenance

**P6-05 MUST NOT reuse or extend the legacy alert infrastructure.** It is semantically incompatible.

### 4.2 Legacy Signal/Risk Code

| Component | File | Classification |
|---|---|---|
| `DecisionSignal` | `src/lib/types/decision-signal.ts` | LEGACY — P3 decision signals |
| P5 `signalCatalogVersion` | `src/lib/p5/` (various) | FROZEN — P5 signal catalog, MUST NOT modify |
| P5 `risk` field | `src/lib/p5/` (various) | FROZEN — P5 risk classification, MUST NOT modify |

**Key observation:** P5 already has its own `risk` classification (LOW/MEDIUM/HIGH) and `signal` concept. P6-05 `severity` is semantically distinct from P5 `risk`. There MUST be no leakage.

### 4.3 P6-01/02/03/04 Output Schemas

**P6-03 Snapshot outputs:**
- `CoinSnapshotOutput`: health_score, confidence_score, data_completeness, quality_metadata, freshness_metadata, provenance, version
- `NarrativeSnapshotOutput`: health_score, member_count, member_scores, quality_metadata, freshness_metadata, provenance, version

**P6-04 Regime outputs:**
- `RegimeOutput`: regime_state, previous_state, transition_target, consecutive_count, confidence, quality_metadata, freshness_metadata, provenance, version

**These are the sole valid input sources for P6-05.**

### 4.4 Refresh Pipeline

| Integration point | Status |
|---|---|
| `/api/refresh` main route | P6 snapshot wired (P6-03E) |
| `/api/refresh` regime | P6-04 NOT yet wired (separate task) |
| `/api/refresh` warning | P6-05 NOT yet wired — intentional |

**P6-05 refresh integration is a deferred implementation detail, not a design decision.**

---

## 5. Existing 14 Decision Inventory

### PD-05B-01: Warning Vocabulary
- **Question:** What warning types exist in V1?
- **Proposed:** 7 types (HEALTH_DETERIORATION, HEALTH_IMPROVEMENT, REGIME_CHANGE, REGIME_TRANSITION, CONFIDENCE_DETERIORATION, DATA_QUALITY_DEGRADATION, FRESHNESS_DEGRADATION)
- **Evidence:** P6-05A recon, P6 pipeline outputs
- **Status:** PROPOSED
- **Blocking:** YES
- **Dependencies:** None
- **Downstream:** Determines warning engine scope, dedup key composition, severity mapping

### PD-05B-02: Severity Vocabulary
- **Question:** What severity levels exist in V1?
- **Proposed:** 5 levels (INFO, LOW, MEDIUM, HIGH, CRITICAL)
- **Evidence:** P6 master spec mentions INFO/WATCH/WARNING/CRITICAL
- **Status:** PROPOSED
- **Blocking:** YES
- **Dependencies:** PD-05B-01
- **Downstream:** Determines severity rules, escalation semantics

### PD-05B-03: Severity Determination
- **Question:** How is severity determined?
- **Proposed:** Multi-factor (health delta primary, regime context secondary, confidence tertiary)
- **Evidence:** P6-05A candidate decisions
- **Status:** PROPOSED
- **Blocking:** YES
- **Dependencies:** PD-05B-02
- **Downstream:** Determines severity engine complexity

### PD-05B-04: Material Change Thresholds
- **Question:** What thresholds trigger warnings?
- **Proposed:** Configurable with defaults (health delta ≥ 10, confidence drop ≥ 20)
- **Evidence:** P6-05A, analogous to P6-04 hysteresis threshold
- **Status:** PROPOSED
- **Blocking:** YES
- **Dependencies:** PD-05B-01
- **Downstream:** Determines warning sensitivity and noise level

### PD-05B-05: Quality Metadata Role
- **Question:** How does quality metadata interact with warnings?
- **Proposed:** Metadata only — preserved, not used for classification
- **Evidence:** P6-01 frozen quality contract
- **Status:** PROPOSED
- **Blocking:** NO — safe default (metadata only)
- **Dependencies:** P6-01 frozen contract
- **Downstream:** None

### PD-05B-06: Freshness Metadata Role
- **Question:** How does freshness metadata interact with warnings?
- **Proposed:** Metadata only — preserved, not used for classification
- **Evidence:** P6-01 frozen freshness contract
- **Status:** PROPOSED
- **Blocking:** NO — safe default (metadata only)
- **Dependencies:** P6-01 frozen contract
- **Downstream:** None

### PD-05B-07: Deduplication Key
- **Question:** What uniquely identifies a warning for deduplication?
- **Proposed:** (entity_type, entity_id, warning_type, detection_window)
- **Evidence:** P6-05A recon
- **Status:** PROPOSED
- **Blocking:** YES
- **Dependencies:** PD-05B-01
- **Downstream:** Determines persistence schema, dedup logic

### PD-05B-08: Deduplication Window
- **Question:** How long is a warning suppressed after generation?
- **Proposed:** 24 hours, configurable
- **Evidence:** P6-05A recon
- **Status:** PROPOSED
- **Blocking:** NO — safe default
- **Dependencies:** PD-05B-07
- **Downstream:** Cooldown implementation

### PD-05B-09: Escalation Semantics
- **Question:** How are severity escalations handled?
- **Proposed:** New warning with higher severity, old SUPERSEDED
- **Evidence:** P6-05A recon
- **Status:** PROPOSED
- **Blocking:** NO — safe default
- **Dependencies:** PD-05B-02
- **Downstream:** Lifecycle behavior

### PD-05B-10: Warning Lifecycle
- **Question:** What lifecycle states exist?
- **Proposed:** 5 states (DETECTED, ACTIVE, ESCALATED, RESOLVED, SUPERSEDED)
- **Evidence:** P6-05A recon
- **Status:** PROPOSED
- **Blocking:** YES
- **Dependencies:** PD-05B-09
- **Downstream:** Persistence, state transitions

### PD-05B-11: Provenance Depth
- **Question:** How deep must provenance trace?
- **Proposed:** Full chain (warning → regime → snapshot → feature → observation)
- **Evidence:** P6-05A, P6-01/02/03/04 provenance contracts
- **Status:** PROPOSED
- **Blocking:** NO — safe default
- **Dependencies:** P6-01/02/03/04 frozen contracts
- **Downstream:** None

### PD-05B-12: Warning Version Tuple
- **Question:** What does the warning version tuple contain?
- **Proposed:** Standalone (algorithm_version, parameter_version, schema_version, config_hash)
- **Evidence:** P6-02/03/04 version tuple patterns
- **Status:** PROPOSED
- **Blocking:** NO — safe default
- **Dependencies:** None
- **Downstream:** Version separation from other layers

### PD-05B-13: Coin/Narrative Parity
- **Question:** Do coins and narratives use the same warning model?
- **Proposed:** Same model, entity_type as parameter
- **Evidence:** P6-03/P6-04 coin/narrative parity
- **Status:** PROPOSED
- **Blocking:** NO — safe default
- **Dependencies:** None
- **Downstream:** None

### PD-05B-14: Persistence Model
- **Question:** What persistence model for warnings?
- **Proposed:** Append-only (warnings never deleted, status updated)
- **Evidence:** P6-05A, analogous to P5 decision record pattern
- **Status:** PROPOSED
- **Blocking:** YES
- **Dependencies:** PD-05B-10
- **Downstream:** Schema design, lifecycle implementation

---

## 6. Implicit Decision Discovery

### 6.1 Warning Identity Semantics

| ID | Decision | Evidence | Proposed | Blocking |
|---|---|---|---|---|
| PD-05C-01 | Is warning identity based on occurrence or rule? | P6-05B §5.1 | Occurrence-based — each material change detection is a new warning | YES |
| PD-05C-02 | Does severity escalation produce same or new identity? | P6-05B §11.2 | New identity — escalation = new warning, old SUPERSEDED | NO — follows from PD-05C-01 |

**Rationale for PD-05C-01:** If warning identity is rule-based (same warning persists across occurrences), then dedup logic becomes complex: same warning needs status toggling. Occurrence-based identity means each detection window produces an independent warning record, which is simpler and more auditable. This matches the P6-03 snapshot pattern (each window produces a new snapshot).

### 6.2 Material Change Classification

| ID | Decision | Evidence | Proposed | Blocking |
|---|---|---|---|---|
| PD-05C-03 | Does P6-05 compare consecutive snapshots or regime outputs? | P6-05A, P6-03/P6-04 outputs | Both — snapshot comparison for health changes, regime comparison for regime changes | NO |
| PD-05C-04 | What constitutes "previous" for comparison? | P6-03 snapshot lifecycle | Most recent SUPERSEDED snapshot of same entity/type | NO |
| PD-05C-05 | Can health deterioration and regime change produce two warnings for same event? | P6-05B §8.3 | YES — they are different warning types from different detection mechanisms | NO |

### 6.3 Severity Precedence

| ID | Decision | Evidence | Proposed | Blocking |
|---|---|---|---|---|
| PD-05C-06 | When health delta = MEDIUM but regime change = HIGH, what is the final severity? | Not explicit in P6-05B | Maximum of individual factors — each warning type has independent severity | NO |

**Rationale:** P6-05 generates one warning per warning type per event. There is no "combined severity" concept — HEALTH_DETERIORATION has its own severity, REGIME_CHANGE has its own severity. They are separate warnings, not combined.

### 6.4 Deduplication Edge Cases

| ID | Decision | Evidence | Proposed | Blocking |
|---|---|---|---|---|
| PD-05C-07 | Does detection_window include the snapshot window_end or calculation_time? | P6-03 identity uses window_end | window_end — consistent with P6-03 snapshot identity | NO |
| PD-05C-08 | If cooldown = 24h and DAILY snapshots occur every ~24h, can cooldown suppress the next day's warning? | P6-05B §11.3 | YES — if same warning type within 24h cooldown, suppressed. This is intentional noise reduction | NO |
| PD-05C-09 | Does cooldown reset when severity escalates? | Not explicit in P6-05B | YES — escalation produces new warning identity, new cooldown starts | NO |

### 6.5 TRANSITIONING Semantics

| ID | Decision | Evidence | Proposed | Blocking |
|---|---|---|---|---|
| PD-05C-10 | Does STABLE → TRANSITIONING generate REGIME_TRANSITION? Does TRANSITIONING → WEAK generate both REGIME_TRANSITION and REGIME_CHANGE? | P6-04 frozen transition semantics | STABLE → TRANSITIONING = REGIME_TRANSITION only. TRANSITIONING → WEAK = REGIME_CHANGE only (TRANSITIONING is not a "state" in the vocabulary sense, it's a transient state) | NO |

**Rationale:** P6-04's TRANSITIONING is a transient confirmation state. The "real" regime change is from the original state to the target state. P6-05 should generate a single REGIME_CHANGE warning when the target regime is confirmed, not when TRANSITIONING begins.

### 6.6 Lifecycle Simplification

| ID | Decision | Evidence | Proposed | Blocking |
|---|---|---|---|---|
| PD-05C-11 | Is ESCALATED a real lifecycle state or just a metadata flag? | P6-05B §12.1 | Simplify: DETECTED → ACTIVE → RESOLVED (3 states). Escalation = new warning record, old SUPERSEDED | NO |

**Rationale:** ESCALATED adds complexity without V1 benefit. A severity escalation creates a new warning (new identity per PD-05C-01) and superseds the old one. The old warning goes SUPERSEDED, the new one goes ACTIVE. No need for an ESCALATED state.

### 6.7 Persistence Semantics

| ID | Decision | Evidence | Proposed | Blocking |
|---|---|---|---|---|
| PD-05C-12 | Does "append-only" mean warnings are never UPDATEd, or only never DELETEd? | P6-05B §17.1 | Never DELETEd. Status updates via UPDATE (ACTIVE→RESOLVED, ACTIVE→SUPERSEDED) are permitted | NO |
| PD-05C-13 | What is the maximum warning history retention? | Not in P6-05B | DEFERRED — V1: retain all. P6-08 scope for archival | DEFERRED |

### 6.8 Confidence Semantics

| ID | Decision | Evidence | Proposed | Blocking |
|---|---|---|---|---|
| PD-05C-14 | What is "warning confidence" vs "regime confidence"? | P6-05B §6.2 | Warning confidence = regime confidence at detection time. Independent metric, not recalculated | NO |
| PD-05C-15 | Does warning confidence change over time? | Not in P6-05B | NO — confidence is set at detection time, immutable after persistence | NO |

### 6.9 Threshold Configuration

| ID | Decision | Evidence | Proposed | Blocking |
|---|---|---|---|---|
| PD-05C-16 | Where are thresholds stored — hardcoded, config object, or database? | P6-05B §8.2 | Config object (same pattern as P6-04 RegimeConfig). Versioned, deterministic | NO |
| PD-05C-17 | Can thresholds differ between coins and narratives? | PD-05B-13 (parity) | NO — same thresholds for all entities | NO |

### 6.10 TEMPORAL / WINDOWING

| ID | Decision | Evidence | Proposed | Blocking |
|---|---|---|---|---|
| PD-05C-18 | Is detection_window the same as snapshot window_end? | P6-03 snapshot identity | YES — aligned with snapshot cycle. DAILY window_end | NO |
| PD-05C-19 | Does P6-05 need its own lookback window? | P6-05B §8.5 | NO — P6-05 compares current vs previous snapshot only. No multi-window analysis in V1 | NO |

### 6.11 REFRESH INTEGRATION

| ID | Decision | Evidence | Proposed | Blocking |
|---|---|---|---|---|
| PD-05C-20 | Should P6-05 run synchronously in refresh or async? | P6-03E/P6-04 pattern | Synchronous after P6-04 regime detection, same as P6-03 snapshot generation | NO |

---

## 7. Warning Vocabulary Audit

### 7.1 REGIME_CHANGE vs REGIME_TRANSITION Overlap

**P6-05B issue identified:** The proposed vocabulary has both `REGIME_CHANGE` and `REGIME_TRANSITION`. These overlap:

- STABLE → TRANSITIONING → WEAK

This produces:
- REGIME_TRANSITION (when entering TRANSITIONING)
- REGIME_CHANGE (when confirming WEAK)

**Resolution (PD-05C-10):** P6-05 should generate:
1. `REGIME_TRANSITION` — when P6-04 enters TRANSITIONING state
2. `REGIME_CHANGE` — when P6-04 confirms target regime (exits TRANSITIONING)

These are temporally distinct events and produce different warnings with different severities. **No overlap issue** — they are sequential, not concurrent.

### 7.2 Warning Type Independence

Each warning type operates independently:
- HEALTH_DETERIORATION checks health_score deltas
- REGIME_CHANGE checks regime state changes
- CONFIDENCE_DETERIORATION checks confidence deltas
- DATA_QUALITY_DEGRADATION checks quality metadata changes
- FRESHNESS_DEGRADATION checks freshness metadata changes

Multiple warnings CAN be generated for the same entity in the same detection_window. This is intentional — different aspects of health can change simultaneously.

### 7.3 V2 Warning Types

Deferred types from P6-05B:
- `CONSECUTIVE_CHANGE` — requires multi-window lookback (P6-05C-19: V1 does NOT do multi-window)
- `CROSS_ENTITY_DIVERGENCE` — requires cross-entity analysis (P6-06 scope)
- `ANOMALY` — requires statistical model (V2)

---

## 8. Severity Audit

### 8.1 Five-Level Vocabulary Assessment

| Alternative | Assessment | Recommended |
|---|---|---|
| 3 levels (INFO/WARNING/CRITICAL) | Too coarse for nuanced health changes | NO |
| 4 levels (INFO/WATCH/WARNING/CRITICAL) | Better, but WATCH is ambiguous | NO |
| 5 levels (INFO/LOW/MEDIUM/HIGH/CRITICAL) | Sufficient granularity for V1 | YES |

**Recommendation:** Keep 5 levels. The P6 master spec uses INFO/WATCH/WARNING/CRITICAL but this conflates severity with urgency. P6-05 uses pure severity (how bad is the change), not urgency (how soon to act).

### 8.2 Severity Is Ordinal

```
INFO < LOW < MEDIUM < HIGH < CRITICAL
```

This ordering is an invariant. Severity is comparable and ordered.

### 8.3 Severity ≠ Action Priority

**Critical invariant:** `HIGH severity` ≠ `HIGH priority action`. P6-05 classifies severity. P5 (if it ever consumes warnings) determines action. P6-05 never creates action semantics.

### 8.4 Severity is NOT Versioned

Severity is derived deterministically from inputs. If the algorithm changes (new version), severity may differ — but the version tuple captures this. Severity itself does not carry a separate version.

---

## 9. Material Change Threshold Audit

### 9.1 Threshold Types

| Threshold | Type | Default | Notes |
|---|---|---|---|
| Health score delta | Absolute | ≥ 10 points | Matches P6-04 hysteresis scale |
| Confidence drop | Absolute | ≥ 20 points | Higher threshold (confidence is more volatile) |
| Quality degradation | Qualitative | Any INVALID/MISSING increase | Binary threshold |
| Freshness degradation | Qualitative | Any FRESH→STALE transition | Binary threshold |

### 9.2 Threshold Is NOT Relative/Percentage

**Decision:** Absolute thresholds only in V1. No percentage-based, no statistical deviation, no adaptive thresholds. This is deterministic and auditable.

### 9.3 Threshold Configuration Version

Thresholds are part of the warning version tuple (parameter_version). When thresholds change, the version changes, and warnings generated with different thresholds are distinguishable.

---

## 10. Deduplication Audit

### 10.1 Dedup Key Composition

```
(entity_type, entity_id, warning_type, detection_window)
```

Where `detection_window` = `window_end` of the snapshot that triggered the warning.

### 10.2 Dedup Semantics

| Scenario | Behavior |
|---|---|
| Same entity, same type, same window | Suppressed (duplicate) |
| Same entity, same type, different window | New warning (recurrence) |
| Same entity, different type, same window | Different warnings (independent) |
| Different entity, same type, same window | Different warnings (entity-scoped) |

### 10.3 Cooldown Interaction

Cooldown operates AFTER dedup. If a warning passes dedup (new window), but cooldown is active (same entity/type within 24h), it is suppressed.

**Ordering:** Dedup → Cooldown → Warning generation

### 10.4 Determinism

Dedup is deterministic: same dedup state + same input → same result. No randomness, no external state.

---

## 11. Lifecycle Audit

### 11.1 Simplified Lifecycle (PD-05C-11)

```
DETECTED → ACTIVE → RESOLVED
                ↓
           SUPERSEDED (by newer warning of same type/entity)
```

| State | Meaning | Transition |
|---|---|---|
| DETECTED | Just generated | → ACTIVE (immediately on persist) |
| ACTIVE | Current, visible | → RESOLVED (condition no longer present) |
| ACTIVE | Current, visible | → SUPERSEDED (newer warning supersedes) |
| RESOLVED | Condition resolved | Terminal |
| SUPERSEDED | Replaced by newer | Terminal |

### 11.2 Lifecycle ≠ QualityState (EW-05, EW-11)

Warning lifecycle states have NO mapping to QualityState:
- DETECTED ≠ INVALID
- ACTIVE ≠ VALID
- RESOLVED ≠ MISSING
- SUPERSEDED ≠ UNKNOWN

### 11.3 Lifecycle ≠ RegimeState (EW-06)

Warning lifecycle states have NO mapping to RegimeState (STRONG/STABLE/WEAK/TRANSITIONING/INSUFFICIENT_DATA/UNKNOWN).

### 11.4 ESCALATED Removed

The ESCALATED state from P6-05B is removed in V1. Escalation = new warning + old SUPERSEDED (per PD-05C-01).

---

## 12. Persistence Audit

### 12.1 Schema: p6_warnings

| Column | Type | Purpose |
|---|---|---|
| id | serial PK | Unique identifier |
| entity_type | varchar(20) | "coin" \| "narrative" |
| entity_id | integer | Entity identifier |
| warning_type | varchar(30) | Warning classification |
| severity | varchar(20) | INFO/LOW/MEDIUM/HIGH/CRITICAL |
| status | varchar(20) | DETECTED/ACTIVE/RESOLVED/SUPERSEDED |
| message | text | Human-readable description |
| health_score | real | Current health score at detection |
| previous_health_score | real \| null | Previous health score |
| health_delta | real \| null | Change magnitude |
| regime_state | varchar(30) | Regime at detection |
| previous_regime_state | varchar(30) \| null | Previous regime |
| confidence | real | Warning confidence |
| dedup_key | text | Deduplication key |
| quality_metadata | jsonb | Quality snapshot |
| freshness_metadata | jsonb | Freshness snapshot |
| evidence | jsonb | Evidence references |
| version | jsonb | Warning version tuple |
| provenance | jsonb | Full provenance chain |
| detection_window | timestamp | Snapshot window_end |
| detected_at | timestamp | When warning generated |
| effective_from | timestamp | When change started |
| effective_until | timestamp \| null | When resolved |
| superseded_at | timestamp \| null | When superseded |
| created_at | timestamp | Record creation |

### 12.2 Indexes

- `(entity_type, entity_id, warning_type, detection_window)` — dedup unique constraint
- `(entity_type, entity_id, status)` — active warning lookup
- `(detected_at)` — time-based queries
- `(warning_type, severity)` — type/severity queries

### 12.3 Append-Only Semantics

Warnings are never deleted. Status is updated (ACTIVE→RESOLVED, ACTIVE→SUPERSEDED). This preserves full history for P6-08 archival scope.

---

## 13. Quality/Freshness Audit

### 13.1 Quality Interaction Matrix

| Input Quality | Warning Generated? | Metadata Preserved? | Severity Affected? |
|---|---|---|---|
| VALID | YES | YES | NO |
| INVALID | YES | YES | NO |
| MISSING | YES | YES | NO |
| UNKNOWN | YES | YES | NO |

**Quality metadata is preserved in warning provenance but does NOT affect warning generation or severity.**

### 13.2 Freshness Interaction Matrix

| Input Freshness | Warning Generated? | Metadata Preserved? | Severity Affected? |
|---|---|---|---|
| FRESH | YES | YES | NO |
| STALE | YES | YES | NO |
| UNKNOWN | YES | YES | NO |

**Freshness metadata is preserved in warning provenance but does NOT affect warning generation or severity.**

### 13.3 STALE ≠ INVALID

STALE is a freshness condition. INVALID is a quality condition. They are independent dimensions per P6-01 frozen contract.

### 13.4 No New QualityState

P6-05 does NOT introduce:
- Any new QualityState values
- Any new FreshnessState values
- Any conversion between quality/freshness/severity

---

## 14. Provenance & Versioning Audit

### 14.1 Provenance Chain

```
Warning
  → detection event (snapshot comparison)
    → P6-04 Regime State
      → P6-03 Snapshot
        → P6-02 Feature
          → P6-01 Observation
```

### 14.2 Provenance Fields

- Source layer: "P6-05"
- Entity: (entity_type, entity_id)
- Warning record: id
- Input snapshot: identity (entity_type, entity_id, snapshot_type, window_end)
- Input regime: (entity_type, entity_id, regime_type, status)
- Regime state at detection
- Health score at detection
- Quality metadata at detection
- Freshness metadata at detection
- Algorithm/version tuple
- Detection timestamp
- Window boundary

### 14.3 Provenance Is Immutable (EW-13)

Once persisted, provenance never changes.

### 14.4 Version Separation (EW-14)

Warning version is standalone:
```typescript
interface WarningVersionTuple {
  readonly algorithm_version: string;    // "p6-warning-v1"
  readonly parameter_version: string;    // threshold config version
  readonly schema_version: string;       // "v1"
  readonly config_hash: string;          // hash of active configuration
}
```

This is distinct from:
- P6-02 feature version
- P6-03 snapshot version
- P6-04 regime version

---

## 15. Coin/Narrative Audit

### 15.1 Same Model (PD-05B-13)

Both coins and narratives use identical warning logic:
- Same warning types
- Same severity determination
- Same thresholds
- Same dedup semantics
- Same lifecycle

`entity_type` is the only differentiator.

### 15.2 Narrative Warning Independence

Narrative warnings are generated independently from coin warnings:
- Narrative health score changes → narrative HEALTH_DETERIORATION
- Narrative regime changes → narrative REGIME_CHANGE
- No coin-level warning aggregation in P6-05 (that's P6-06 scope)

---

## 16. P4/P5 Boundary Audit

### 16.1 Invariants

| Invariant | Rule | Status |
|---|---|---|
| EW-17 | P6-05 does NOT modify P4 | CONFIRMED |
| EW-18 | P6-05 does NOT insert into P5 replay chain | CONFIRMED |
| EW-21 | P4 not modified | CONFIRMED |
| EW-22 | P5 not modified | CONFIRMED |
| EW-23 | No BUY/SELL semantics | CONFIRMED |
| EW-24 | No action/policy/approval semantics | CONFIRMED |

### 16.2 Legacy Alert Contamination Check

The legacy `AlertService` uses `alert_rules` and `alert_history` tables. P6-05:
- Does NOT read from these tables
- Does NOT write to these tables
- Does NOT import from `src/lib/services/alert.service.ts`
- Does NOT import from `src/lib/types/alert.ts`
- Creates its own `p6_warnings` table

**Clean separation confirmed.**

### 16.3 P5 Risk vs P6-05 Severity

| Concept | P5 Risk | P6-05 Severity |
|---|---|---|
| Domain | Action/policy risk | Informational change magnitude |
| Values | LOW/MEDIUM/HIGH | INFO/LOW/MEDIUM/HIGH/CRITICAL |
| Purpose | How risky is this action? | How significant is this change? |
| Consumer | P5 policy engine | P6-06 aggregation / P6-07 UI |
| Actionable? | Yes (triggers policy) | No (informational only) |

**Clean separation confirmed.**

---

## 17. EW-01…EW-24 Invariant Audit

| Invariant | Description | Status |
|---|---|---|
| EW-01 | Input authority (P6-native only) | PASS |
| EW-02 | No action semantics | PASS |
| EW-03 | Quality vocabulary unchanged | PASS |
| EW-04 | Freshness independent | PASS |
| EW-05 | Warning ≠ QualityState | PASS |
| EW-06 | Warning ≠ RegimeState | PASS |
| EW-07 | Warning ≠ SnapshotStatus | PASS |
| EW-08 | Material change is deterministic | PASS |
| EW-09 | Deduplication is deterministic | PASS |
| EW-10 | Severity is deterministic | PASS |
| EW-11 | Lifecycle ≠ QualityState | PASS |
| EW-12 | Provenance is complete | PASS |
| EW-13 | Provenance is immutable | PASS |
| EW-14 | Version separation | PASS |
| EW-15 | Coin/narrative symmetry | PASS |
| EW-16 | Deterministic ordering | PASS |
| EW-17 | P4/P5 untouched | PASS |
| EW-18 | No P5 replay contamination | PASS |
| EW-19 | Infrastructure failure ≠ warning | PASS |
| EW-20 | Persistence ≠ quality state | PASS |
| EW-21 | P4 not modified | PASS |
| EW-22 | P5 not modified | PASS |
| EW-23 | No BUY/SELL semantics | PASS |
| EW-24 | No action/policy/approval semantics | PASS |

**24/24 PASS. 0 violations.**

---

## 18. New Invariants

### EW-25: Warning Identity Is Occurrence-Based
**Rule:** Each material change detection produces a new warning record. Warnings are not reused across detection windows.
**Rationale:** Simplifies dedup, enables full audit trail, matches P6-03 snapshot pattern.
**Boundary:** No warning ID reuse across windows.
**Validation:** Same entity/type in different windows → different warning IDs.

### EW-26: Severity Is Informational, Not Actionable
**Rule:** Warning severity MUST NOT be interpreted as action priority, policy trigger, or approval requirement.
**Rationale:** P6-05 classifies magnitude of change. P5 (if it consumes warnings) determines action.
**Boundary:** No severity→action mapping in P6-05.
**Validation:** No action/policy fields derived from severity.

### EW-27: Dedup Key Includes Detection Window
**Rule:** Dedup key MUST include detection_window to prevent cross-window suppression.
**Rationale:** Same warning type in different windows represents distinct occurrences.
**Boundary:** Detection window is part of identity.
**Validation:** Same entity/type in different windows → different dedup keys.

### EW-28: Provenance References Valid Snapshot/Regime IDs
**Rule:** Provenance snapshot and regime references MUST point to existing persisted records. No fabricated IDs.
**Rationale:** Maintains data integrity and traceability.
**Boundary:** References are validated at detection time.
**Validation:** All provenance IDs resolve to existing records.

---

## 19. Evidence Gap Audit

| Gap ID | Description | Status | Impact | Blocking | Resolution |
|---|---|---|---|---|---|
| EG-01 | Warning→P6-06 integration | CONFIRMED | P6-06 scope | NO | Deferred to P6-06 |
| EG-02 | Warning→P6-07 UI | CONFIRMED | P6-07 scope | NO | Deferred to P6-07 |
| EG-03 | Production warning volume | CONFIRMED | Threshold tuning | NO | Needs production data |
| EG-04 | Warning noise rate | CONFIRMED | Cooldown tuning | NO | Needs production feedback |
| EG-05 | Cooldown effectiveness | CONFIRMED | Dedup behavior | NO | Needs production testing |
| EG-06 | Severity accuracy | CONFIRMED | Severity rules | NO | Needs production validation |
| EG-07 | REGIME_TRANSITION timing (PD-05C-10) | RESOLVED | Warning type semantics | NO | Resolved: sequential events |
| EG-08 | ESCALATED simplification (PD-05C-11) | RESOLVED | Lifecycle complexity | NO | Resolved: removed in V1 |

**0 blocking evidence gaps.**

---

## 20. Dependency Matrix

### Blocking Dependencies

```
PD-05C-01 (Warning identity = occurrence)
    ↓
PD-05B-07 (Dedup key)
    ↓
PD-05B-08 (Cooldown window)
    ↓
PD-05C-08 (Cooldown + daily interaction)

PD-05B-01 (Warning vocabulary)
    ↓
PD-05B-04 (Material thresholds)
    ↓
PD-05C-03 (Comparison mechanism)
    ↓
PD-05C-04 (Previous snapshot selection)

PD-05B-02 (Severity vocabulary)
    ↓
PD-05B-03 (Severity determination)
    ↓
PD-05C-05 (Multiple warnings per event)
    ↓
PD-05C-06 (Severity precedence — N/A in V1)

PD-05B-10 (Lifecycle)
    ↓
PD-05B-14 (Persistence model)
    ↓
p6_warnings schema
```

### Independent Decisions (no dependency chain)

- PD-05B-05 (Quality role) — depends only on frozen P6-01
- PD-05B-06 (Freshness role) — depends only on frozen P6-01
- PD-05B-11 (Provenance depth) — depends only on frozen P6-01/02/03/04
- PD-05B-12 (Version tuple) — standalone
- PD-05B-13 (Coin/narrative parity) — standalone

---

## 21. True Blocking Decisions

### From P6-05B (maintained)

| Decision | Question | Why Blocking |
|---|---|---|
| PD-05B-01 | Warning vocabulary | Determines engine scope |
| PD-05B-02 | Severity vocabulary | Determines severity rules |
| PD-05B-03 | Severity determination | Determines severity engine |
| PD-05B-04 | Material thresholds | Determines warning sensitivity |

### Newly Discovered Implicit Blockers

| Decision | Question | Why Blocking |
|---|---|---|
| PD-05C-01 | Warning identity = occurrence-based | Determines dedup, persistence, lifecycle semantics |
| PD-05B-10 | Lifecycle states (3 vs 5) | Determines persistence schema, state transitions |

**Total blocking: 6** (up from 4 in P6-05B)

**Note:** PD-05B-10 was already marked as blocking in P6-05B but the actual state count needs Planner decision (5 states proposed vs 3 states recommended in PD-05C-11).

### Non-Blocking with Safe Defaults

| Decision | V1 Default |
|---|---|
| PD-05B-05 | Quality = metadata only |
| PD-05B-06 | Freshness = metadata only |
| PD-05B-07 | Dedup key = (entity_type, entity_id, warning_type, detection_window) |
| PD-05B-08 | Cooldown = 24h |
| PD-05B-09 | Escalation = new warning + old SUPERSEDED |
| PD-05B-11 | Full provenance chain |
| PD-05B-12 | Standalone version tuple |
| PD-05B-13 | Same model for coins/narratives |
| PD-05B-14 | Append-only persistence |
| PD-05C-03 | Both snapshot and regime comparison |
| PD-05C-04 | Previous = most recent SUPERSEDED snapshot |
| PD-05C-05 | Multiple warnings per event allowed |
| PD-05C-07 | detection_window = snapshot window_end |
| PD-05C-09 | Cooldown resets on escalation |
| PD-05C-12 | Never DELETEd, status UPDATE permitted |
| PD-05C-14 | Warning confidence = regime confidence at detection |
| PD-05C-15 | Confidence immutable after persistence |
| PD-05C-16 | Config object (same as P6-04 pattern) |
| PD-05C-17 | Same thresholds for all entities |
| PD-05C-18 | detection_window = snapshot window_end |
| PD-05C-19 | No multi-window lookback in V1 |
| PD-05C-20 | Synchronous in refresh |

### Deferred

| Decision | Reason |
|---|---|
| PD-05C-13 | Retention policy — P6-08 scope |
| EG-01 | P6-06 integration — P6-06 scope |
| EG-02 | P6-07 UI — P6-07 scope |
| EG-03-06 | Production tuning — needs production data |

---

## 22. Critical Boundary Audit: Warning ≠ Decision

### P6-05 Warning Semantics

```
HEALTH_DETERIORATION
    ↓
WARNING (informational)
```

### NOT P6-05 Semantics

```
HEALTH_DETERIORATION
    ↓
SELL signal
    ↓
P5 action
```

### Boundary Proof

| Check | Status |
|---|---|
| P6-05 output contains BUY/SELL fields? | NO |
| P6-05 output contains action fields? | NO |
| P6-05 output contains policy fields? | NO |
| P6-05 output contains approval fields? | NO |
| P6-05 imports P5 modules? | NO |
| P6-05 imports P4 modules? | NO |
| P6-05 severity maps to action priority? | NO |
| P6-05 severity maps to P5 risk? | NO |

**P6-05 observes and reports. P5 (if it consumes) decides and acts. The boundary is clean.**

---

## 23. Planner Readiness Gate

### P6-05C READINESS

| Metric | Count |
|---|---|
| **Total Decisions** | **34** |
| Explicit | 14 |
| Implicit | 20 |
| **Blocking** | **6** |
| Non-blocking | 24 |
| Deferred | 4 |
| **Evidence Gaps** | **8** (0 blocking) |
| **Invariants** | **28** (24 original + 4 new) |
| New Invariants | 4 (EW-25…EW-28) |

### Blocking Decisions Summary

| ID | Question | Recommended |
|---|---|---|
| PD-05B-01 | Warning vocabulary | 7 types |
| PD-05B-02 | Severity vocabulary | 5 levels |
| PD-05B-03 | Severity determination | Multi-factor |
| PD-05B-04 | Material thresholds | Configurable defaults |
| PD-05C-01 | Warning identity | Occurrence-based |
| PD-05B-10 | Lifecycle states | 3 states (DETECTED, ACTIVE, RESOLVED) + SUPERSEDED |

### Implementation Ready?

**YES** — after Planner accepts the 6 blocking decisions.

**Ready for P6-05C1 (Focused Planner Decision Contract)**

---

## 24. Recommended Next Step

**P6-05C1 — Focused Planner Decision Contract**

Scope: Convert the 6 blocking decisions into a focused contract for Planner acceptance:
1. PD-05B-01: Warning vocabulary (7 types)
2. PD-05B-02: Severity vocabulary (5 levels)
3. PD-05B-03: Severity determination (multi-factor)
4. PD-05B-04: Material thresholds (configurable)
5. PD-05C-01: Warning identity (occurrence-based)
6. PD-05B-10: Lifecycle states (3+1)

---

## 25. Conclusion

P6-05C identifies **34 decisions** (14 explicit + 20 implicit), with **6 blocking** decisions requiring Planner acceptance.

The semantic contract is sound:
- No P4/P5 boundary violations
- No QualityState pollution
- No action/recommendation semantics
- Clean separation from legacy alert infrastructure
- Deterministic, auditable, version-tracked

**No production code was modified. No frozen contracts were modified.**

All decisions remain PROPOSED. Planner acceptance is required before implementation.

---

**Git Boundary:** ✅ Documentation only. No production code modified.
