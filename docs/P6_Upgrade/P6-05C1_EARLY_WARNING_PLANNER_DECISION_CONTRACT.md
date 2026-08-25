# P6-05C1 — Early Warning Focused Planner Decision Contract

## 1. Executive Summary

P6-05C1 converts the 6 BLOCKING decisions identified by P6-05C into a focused contract for Planner acceptance.

**Source documents:**
- P6-05A Landscape Recon (914c109)
- P6-05B Semantic Contract (7e30fc7)
- P6-05C Decision Inventory (bf1da93)

**Key numbers:**
- 6 blocking decisions requiring Planner acceptance
- 20 implicit decisions resolved by the 6 blockers
- 28 invariants (EW-01…EW-28)
- 0 evidence gaps blocking implementation
- All decisions remain PROPOSED — none frozen by Agent

**Flow:**
```
P6-05A ✅ → P6-05B ✅ → P6-05C ✅ → P6-05C1 ← THIS
  ↓
PLANNER FREEZE (6 decisions) → P6-05D → P6-05E → P6-05-FINAL
```

---

## 2. PD-05B-01 — WARNING VOCABULARY

### Question
What warning types exist in V1?

### Proposed Resolution

**7 warning types:**

| Warning Type | Semantic Meaning | Trigger | Scope |
|---|---|---|---|
| `HEALTH_DETERIORATION` | Entity health score declined materially | P6-03 snapshot health_score delta ≥ threshold | V1 |
| `HEALTH_IMPROVEMENT` | Entity health score improved materially | P6-03 snapshot health_score delta ≥ threshold | V1 |
| `REGIME_CHANGE` | Entity regime state changed to a confirmed new state | P6-04 regime transition completed (exits TRANSITIONING) | V1 |
| `REGIME_TRANSITION` | Entity entered TRANSITIONING state | P6-04 regime enters TRANSITIONING | V1 |
| `CONFIDENCE_DETERIORATION` | Regime classification confidence dropped materially | P6-04 confidence delta ≥ threshold | V1 |
| `DATA_QUALITY_DEGRADATION` | Quality metadata degraded (more INVALID/MISSING) | P6-03 quality_metadata change | V1 |
| `FRESHNESS_DEGRADATION` | Freshness metadata degraded (FRESH→STALE) | P6-03 freshness_metadata change | V1 |

### Analysis

**Can all 7 coexist?** Yes. Each warning type monitors a different aspect of the P6 pipeline output. They operate independently — a single entity can generate multiple warnings of different types in the same detection window.

**REGIME_CHANGE vs REGIME_TRANSITION coexistence:** These are temporally sequential, not concurrent:
```
STABLE → TRANSITIONING → WEAK

Timeline:
  Day 1: regime = TRANSITIONING   → REGIME_TRANSITION warning
  Day 2: regime = WEAK (confirmed) → REGIME_CHANGE warning
```
They represent distinct events at different times. No overlap.

**Single event producing multiple warnings:** YES. A health score drop (HEALTH_DETERIORATION) can coincide with a regime change (REGIME_CHANGE). These are independent detections. P6-05 generates one warning per applicable warning type.

**Does any type duplicate P6-04?** NO. P6-04 classifies regime state. P6-05 detects that a regime state change occurred and generates an informational warning. P6-05 does NOT recalculate or reinterpret regime.

### Why Required
Determines the warning engine's scope, the dedup key composition (each type is independent), and the severity mapping rules.

### What Depends on It
- PD-05B-04 (material thresholds — per-type thresholds)
- PD-05B-07 (dedup key — includes warning_type)
- PD-05C-03 (comparison mechanism — per-type detection logic)
- All warning engine implementation

---

## 3. PD-05B-02 — SEVERITY VOCABULARY

### Question
What severity levels exist in V1?

### Proposed Resolution

**5 ordinal levels:**

| Level | Semantic Meaning | Typical Context |
|---|---|---|
| `INFO` | Informational change, no action implied | Minor health improvement, routine regime transition |
| `LOW` | Minor change, monitoring suggested | Small health delta, minor confidence fluctuation |
| `MEDIUM` | Notable change, attention recommended | Moderate health deterioration, regime transition with low confidence |
| `HIGH` | Significant change, immediate attention | Large health deterioration, regime change to WEAK |
| `CRITICAL` | Severe change, urgent attention | Extreme health deterioration, rapid regime collapse |

### Analysis

**Why 5 levels?**
- 3 levels (INFO/WARNING/CRITICAL): too coarse — can't distinguish "minor concern" from "significant change"
- 4 levels (INFO/WATCH/WARNING/CRITICAL): WATCH is ambiguous — conflates severity with urgency
- 5 levels: sufficient granularity for V1 health monitoring

**Severity is ordinal:**
```
INFO < LOW < MEDIUM < HIGH < CRITICAL
```
This ordering is an invariant. Severity is comparable and ordered.

**CRITICAL has NO special operational semantics.** It is the highest severity level. It does NOT trigger actions, policies, or approvals. It is informational classification only.

**CRITICAL ≠ action required.** A CRITICAL warning means "the change was very significant." It does NOT mean "do something now." P5 (if it ever consumes warnings) decides action.

### Why Required
Determines the severity rules engine and the vocabulary for all warning output.

### What Depends on It
- PD-05B-03 (severity determination — maps inputs to these levels)
- PD-05B-09 (escalation — severity increase triggers new warning)
- All severity classification logic

---

## 4. PD-05B-03 — SEVERITY DETERMINATION

### Question
How is severity determined?

### Proposed Resolution

**Multi-factor model with explicit hierarchy:**

```
severity = f(health_delta_magnitude, regime_context, confidence_context, warning_type)
```

**Factor hierarchy (strict precedence):**

| Priority | Factor | Weight | Description |
|---|---|---|---|
| 1 (Primary) | Health delta magnitude | Deterministic | Absolute change in health_score |
| 2 (Secondary) | Regime context | Modifier | Current regime state at detection |
| 3 (Tertiary) | Confidence context | Modifier | Warning confidence at detection |
| 4 (Context) | Warning type | Baseline | Default severity for warning type |

**Severity determination rules:**

**For HEALTH_DETERIORATION / HEALTH_IMPROVEMENT:**

| Health Delta (absolute) | Regime Context | Severity |
|---|---|---|
| ≥ 30 points | Any | CRITICAL |
| ≥ 20 points | WEAK regime | HIGH |
| ≥ 20 points | STABLE/STRONG regime | MEDIUM |
| ≥ 10 points | WEAK regime | MEDIUM |
| ≥ 10 points | STABLE/STRONG regime | LOW |
| ≥ 5 points | Any | INFO |
| < 5 points | Any | No warning generated |

**For REGIME_CHANGE:**

| Direction | Target Regime | Severity |
|---|---|---|
| Deterioration | WEAK | HIGH |
| Deterioration | STABLE | MEDIUM |
| Improvement | STRONG | LOW |
| Improvement | STABLE | INFO |

**For REGIME_TRANSITION:**

| Transition Target | Confidence | Severity |
|---|---|---|
| WEAK | < 50% | HIGH |
| WEAK | ≥ 50% | MEDIUM |
| STRONG | Any | LOW |
| STABLE | Any | INFO |

**For CONFIDENCE_DETERIORATION:**

| Confidence Delta | Severity |
|---|---|
| ≥ 30 points | HIGH |
| ≥ 20 points | MEDIUM |
| ≥ 10 points | LOW |
| < 10 points | No warning generated |

**For DATA_QUALITY_DEGRADATION:**

| Change | Severity |
|---|---|
| VALID → INVALID | MEDIUM |
| VALID → MISSING | LOW |
| Any degradation | INFO |

**For FRESHNESS_DEGRADATION:**

| Change | Severity |
|---|---|
| FRESH → STALE | LOW |
| Any degradation | INFO |

### Analysis

**Determinism:** Same inputs + same versions + same configuration → same severity. No randomness, no external state.

**Tie-breaking:** When multiple factors conflict (e.g., health delta suggests LOW but regime context suggests HIGH), the HIGHEST severity wins. This is explicit, not ambiguous.

**Severity is NOT:**
- Action priority
- BUY/SELL signal
- Policy trigger
- P5 risk classification

**Thresholds are explicit, versioned, and auditable.** They are part of the warning configuration (parameter_version in version tuple). When thresholds change, the version changes.

### Why Required
Determines the severity engine complexity and all warning output classification.

### What Depends on It
- All severity classification logic
- Escalation detection (severity increase = new warning)

---

## 5. PD-05B-04 — MATERIAL CHANGE THRESHOLDS

### Question
What thresholds trigger warnings?

### Proposed Resolution

**Configurable thresholds with explicit V1 defaults:**

### 5.1 Per-Type Thresholds

| Warning Type | Threshold | Type | Direction | V1 Default |
|---|---|---|---|---|
| HEALTH_DETERIORATION | health_score_delta | Absolute | Negative | ≥ 10 points drop |
| HEALTH_IMPROVEMENT | health_score_delta | Absolute | Positive | ≥ 10 points rise |
| REGIME_CHANGE | regime_state_change | Qualitative | Any | Any confirmed transition |
| REGIME_TRANSITION | regime_state_change | Qualitative | Any | Entering TRANSITIONING |
| CONFIDENCE_DETERIORATION | confidence_delta | Absolute | Negative | ≥ 20 points drop |
| DATA_QUALITY_DEGRADATION | quality_change | Qualitative | Degradation | Any INVALID/MISSING increase |
| FRESHNESS_DEGRADATION | freshness_change | Qualitative | Degradation | Any FRESH→STALE transition |

### 5.2 Threshold Properties

**Absolute, not relative:** All thresholds are absolute point values on the 0–100 scale. No percentage, no statistical deviation, no adaptive thresholds in V1.

**Global, not per-entity:** Same thresholds for coins and narratives (PD-05C-17).

**Global, not per-entity-type:** HEALTH_DETERIORATION threshold is the same for coin health and narrative health.

**Directional:** HEALTH_DETERIORATION requires negative delta. HEALTH_IMPROVEMENT requires positive delta. Symmetric thresholds.

**Boundary equality:** Delta ≥ 10 means exactly 10 triggers a warning. Inclusive boundary (consistent with P6-04 boundary semantics).

**Minimum observation count:** P6-05 requires at least 2 snapshots (current + previous) to compute delta. With < 2 snapshots, no health change warning is generated.

**Configuration version:** Thresholds are part of the warning version tuple (parameter_version). Changing thresholds changes the version.

### 5.3 Threshold Configuration Object

```typescript
interface WarningConfig {
  readonly healthDeltaThreshold: number;         // V1: 10
  readonly confidenceDeltaThreshold: number;     // V1: 20
  readonly cooldownHours: number;                // V1: 24
  readonly minSnapshotsForComparison: number;    // V1: 2
}
```

### Analysis

**Why absolute thresholds?** Deterministic, auditable, easy to reason about. Relative thresholds (percentage-based) add complexity without V1 benefit.

**Why ≥ 10 for health?** Matches P6-04's hysteresis threshold scale. Health scores operate on 0–100. A 10-point change is ~10% of the scale — material but not extreme.

**Why ≥ 20 for confidence?** Confidence is more volatile than health score. A higher threshold prevents noise.

**Quality/freshness thresholds are qualitative (binary):** Any degradation triggers a warning. There's no "degree" of quality degradation in V1.

### Why Required
Determines warning sensitivity, noise level, and the boundary between "material" and "immaterial" change.

### What Depends on It
- All warning generation logic
- Warning noise characteristics
- Cooldown interaction (threshold determines initial warning frequency)

---

## 6. PD-05C-01 — WARNING IDENTITY

### Question
Is warning identity occurrence-based or rule-based?

### Proposed Resolution

**OCCURRENCE-BASED IDENTITY**

### 6.1 Identity Tuple

```
(entity_type, entity_id, warning_type, detection_window)
```

Where:
- `entity_type`: "coin" | "narrative"
- `entity_id`: numeric entity identifier
- `warning_type`: one of the 7 warning types
- `detection_window`: the snapshot window_end that triggered the detection

### 6.2 What Constitutes a New Occurrence

| Scenario | New Occurrence? | Reason |
|---|---|---|
| Same entity, same type, different detection_window | YES | Different window = different detection event |
| Same entity, same type, same detection_window | NO | Deduplicated — same event |
| Same entity, different type, same detection_window | YES | Different warning type = independent detection |
| Different entity, same type, same detection_window | YES | Entity-scoped warnings |
| Same entity, same type, resolved then re-triggered | YES | New window = new occurrence |

### 6.3 Occurrence vs Rule-Based Identity

**Rule-based (rejected):** Same warning persists across occurrences, status toggles (ACTIVE↔RESOLVED). Complex dedup, hard to audit, no full history.

**Occurrence-based (accepted):** Each detection window produces a new warning record. Simpler, more auditable, matches P6-03 snapshot pattern (each window produces a new snapshot).

### 6.4 Deduplication

Dedup key = identity tuple. Same identity = suppressed as duplicate. Different identity = new warning.

Cooldown operates after dedup:
```
Dedup check → Cooldown check → Warning generation
```

### 6.5 Severity Escalation and Identity

Severity escalation produces a NEW warning record (new identity — different detection_window or different severity triggers new detection). The old warning transitions to SUPERSEDED. This is NOT an update to the existing warning.

### 6.6 Resolved Warning Re-Triggering

If a warning is RESOLVED and the same condition re-occurs in a later detection_window:
- New warning record (new identity — different detection_window)
- New lifecycle starts at ACTIVE
- Old warning remains RESOLVED (terminal)

### 6.7 Why This Is Blocking

Warning identity determines:
- Persistence schema (unique constraint = identity tuple)
- Dedup logic (same identity = suppressed)
- Lifecycle management (each occurrence has independent lifecycle)
- Audit trail (each occurrence is a separate record)
- Provenance (each occurrence traces to specific detection event)

### What Depends on It
- PD-05B-07 (dedup key = identity tuple)
- PD-05B-08 (cooldown — operates on identity)
- PD-05B-14 (persistence — unique constraint)
- All dedup, lifecycle, persistence logic

---

## 7. PD-05B-10 — WARNING LIFECYCLE

### Question
What lifecycle states exist?

### Proposed Resolution

**4 states (3 active + 1 terminal):**

```
DETECTED → ACTIVE → RESOLVED
                ↓
           SUPERSEDED
```

| State | Meaning | Allowed Transitions | Terminal? |
|---|---|---|---|
| `DETECTED` | Warning just generated, about to persist | → ACTIVE | NO |
| `ACTIVE` | Warning is current and visible | → RESOLVED, → SUPERSEDED | NO |
| `RESOLVED` | Condition no longer present | None (terminal) | YES |
| `SUPERSEDED` | Replaced by newer warning of same entity/type | None (terminal) | YES |

### 7.1 State Transition Rules

**DETECTED → ACTIVE:**
- Occurs immediately on successful persistence
- Warning is now visible to consumers
- No intermediate state between detection and activation

**ACTIVE → RESOLVED:**
- Triggered when the condition that caused the warning no longer exists
- Example: health score returns above threshold, regime stabilizes
- Resolution is determined by re-evaluation against the same thresholds
- Only ACTIVE warnings can be resolved

**ACTIVE → SUPERSEDED:**
- Triggered when a NEW warning of the same (entity_type, entity_id, warning_type) is generated
- The new warning becomes ACTIVE
- The old warning transitions to SUPERSEDED
- SUPERSEDED warnings retain full provenance and evidence

**DETECTED → RESOLVED:**
- NOT allowed. A warning must pass through ACTIVE before it can be resolved.
- Rationale: If a warning is generated, it was material at detection time. It must be visible (ACTIVE) before resolution.

**RESOLVED → ACTIVE (reopening):**
- NOT allowed. Resolution is terminal.
- If the condition re-occurs, a NEW warning record is created (new occurrence per PD-05C-01).

### 7.2 ESCALATED State Removed

The original P6-05B proposed 5 states including ESCALATED. P6-05C recommends removing ESCALATED:

**Rationale:** Escalation = new warning (new identity) + old SUPERSEDED. No need for an intermediate ESCALATED state. The new warning starts at ACTIVE with higher severity. The old warning goes directly to SUPERSEDED.

**Complexity reduction:** 4 states instead of 5. Simpler state machine, fewer transitions, easier to audit.

### 7.3 Lifecycle ≠ QualityState

| Lifecycle State | QualityState | Mapping? |
|---|---|---|
| DETECTED | INVALID | NO |
| ACTIVE | VALID | NO |
| RESOLVED | MISSING | NO |
| SUPERSEDED | UNKNOWN | NO |

Warning lifecycle and QualityState are separate semantic domains with no mapping.

### 7.4 Lifecycle ≠ RegimeState

| Lifecycle State | RegimeState | Mapping? |
|---|---|---|
| ACTIVE | STRONG/STABLE/WEAK | NO |
| SUPERSEDED | TRANSITIONING | NO |

Warning lifecycle and RegimeState are separate semantic domains with no mapping.

### 7.5 Why This Is Blocking

Lifecycle determines:
- Persistence schema (status column values)
- State transition logic
- Resolution detection algorithm
- Supersession detection
- Consumer visibility (only ACTIVE warnings are "current")

### What Depends on It
- PD-05B-09 (escalation semantics — subsumed by lifecycle)
- PD-05B-14 (persistence model — status column)
- All lifecycle management logic

---

## 8. IMPLICIT DECISION DEPENDENCY MATRIX

### How the 6 Blockers Resolve All 20 Implicit Decisions

| Implicit Decision | Question | Blocked By | Resolution When Blocker Accepted |
|---|---|---|---|
| PD-05C-02 | Severity escalation identity | PD-05C-01 | New identity — escalation = new warning, old SUPERSEDED |
| PD-05C-03 | Comparison mechanism | PD-05B-01 | Both snapshot and regime comparison, per-type |
| PD-05C-04 | "Previous" for comparison | PD-05B-01 | Most recent SUPERSEDED snapshot of same entity/type |
| PD-05C-05 | Multiple warnings per event | PD-05B-01 | YES — independent warning types |
| PD-05C-06 | Severity precedence | PD-05B-02 | Maximum of individual factors — per-type severity |
| PD-05C-07 | detection_window source | PD-05C-01 | snapshot window_end |
| PD-05C-08 | Cooldown + daily interaction | PD-05B-04 | Cooldown suppresses within 24h — intentional |
| PD-05C-09 | Cooldown reset on escalation | PD-05C-01 | YES — new identity = new cooldown |
| PD-05C-10 | REGIME_TRANSITION timing | PD-05B-01 | Sequential: TRANSITION first, CHANGE when confirmed |
| PD-05C-11 | ESCALATED simplification | PD-05B-10 | Removed — escalation = new warning + SUPERSEDED |
| PD-05C-12 | Append-only semantics | PD-05B-10 | Never DELETEd, status UPDATE permitted |
| PD-05C-13 | Retention policy | — | DEFERRED (P6-08 scope) |
| PD-05C-14 | Warning vs regime confidence | PD-05B-01 | Warning confidence = regime confidence at detection |
| PD-05C-15 | Confidence immutability | PD-05B-01 | Set at detection, immutable after persistence |
| PD-05C-16 | Threshold storage | PD-05B-04 | Config object, versioned (same as P6-04 pattern) |
| PD-05C-17 | Per-entity thresholds | PD-05B-04 | NO — same thresholds for all entities |
| PD-05C-18 | detection_window = window_end | PD-05C-01 | YES — aligned with P6-03 snapshot identity |
| PD-05C-19 | Multi-window lookback | PD-05B-04 | NO — V1 compares current vs previous only |
| PD-05C-20 | Refresh integration timing | PD-05B-10 | Synchronous after P6-04, same pattern as P6-03 |

### Resolution Summary

| Blocker Accepted | Implicit Decisions Resolved |
|---|---|
| PD-05B-01 (vocabulary) | PD-05C-03, 04, 05, 10, 14, 15 (6) |
| PD-05B-02 (severity) | PD-05C-06 (1) |
| PD-05B-03 (determination) | None directly — applies vocabulary |
| PD-05B-04 (thresholds) | PD-05C-08, 16, 17, 18, 19 (5) |
| PD-05C-01 (identity) | PD-05C-02, 07, 09 (3) |
| PD-05B-10 (lifecycle) | PD-05C-11, 12, 20 (3) |
| **Deferred** | PD-05C-13 (1) |
| **Total resolved** | **19 of 20** |

**Once all 6 blockers are accepted, 19 of 20 implicit decisions are fully resolved.** Only PD-05C-13 (retention) remains deferred to P6-08.

---

## 9. CROSS-CONTRACT CONSISTENCY AUDIT

### 9.1 P6-01 (Observation/Quality) — FROZEN

| Check | Status |
|---|---|
| QualityState remains VALID/INVALID/MISSING/UNKNOWN | ✅ COMPATIBLE |
| No new QualityState introduced | ✅ COMPATIBLE |
| Infrastructure failure ≠ quality | ✅ COMPATIBLE |
| Quality is metadata in P6-05 | ✅ COMPATIBLE (PD-05B-05) |
| Freshness is metadata in P6-05 | ✅ COMPATIBLE (PD-05B-06) |
| No quality→severity conversion | ✅ COMPATIBLE |
| No freshness→severity conversion | ✅ COMPATIBLE |

### 9.2 P6-02 (Derived Features) — FROZEN

| Check | Status |
|---|---|
| Derived feature semantics unchanged | ✅ COMPATIBLE |
| Provenance/version semantics preserved | ✅ COMPATIBLE |
| P6-05 reads health_score from P6-03, not directly from P6-02 | ✅ COMPATIBLE |
| No feature reinterpretation | ✅ COMPATIBLE |

### 9.3 P6-03 (Intelligence Snapshot) — FROZEN

| Check | Status |
|---|---|
| Snapshot semantics unchanged | ✅ COMPATIBLE |
| No snapshot reinterpretation | ✅ COMPATIBLE |
| P6-05 reads snapshot output as-is | ✅ COMPATIBLE |
| Snapshot identity preserved | ✅ COMPATIBLE |
| Snapshot lifecycle (CURRENT/SUPERSEDED) preserved | ✅ COMPATIBLE |

### 9.4 P6-04 (Trend/Regime) — FROZEN

| Check | Status |
|---|---|
| Regime vocabulary unchanged (6 states) | ✅ COMPATIBLE |
| Regime threshold/hysteresis unchanged | ✅ COMPATIBLE |
| P6-05 reads regime output as-is | ✅ COMPATIBLE |
| REGIME_CHANGE warning consumes regime output, doesn't redefine it | ✅ COMPATIBLE |
| REGIME_TRANSITION warning consumes regime output, doesn't redefine it | ✅ COMPATIBLE |
| No regime recalculation in P6-05 | ✅ COMPATIBLE |

### 9.5 P4/P5 — FROZEN

| Check | Status |
|---|---|
| P4 not modified | ✅ COMPATIBLE |
| P5 not modified | ✅ COMPATIBLE |
| No BUY/SELL semantics in P6-05 | ✅ COMPATIBLE |
| No action semantics in P6-05 | ✅ COMPATIBLE |
| No P5 replay contamination | ✅ COMPATIBLE |
| P6-05 warnings not consumed by P4 | ✅ COMPATIBLE |
| P6-05 warnings not consumed by P5 | ✅ COMPATIBLE |
| P6-05 severity ≠ P5 risk | ✅ COMPATIBLE |

### 9.6 Legacy Alert Infrastructure

| Check | Status |
|---|---|
| P6-05 does NOT read alert_rules | ✅ COMPATIBLE |
| P6-05 does NOT read alert_history | ✅ COMPATIBLE |
| P6-05 does NOT import AlertService | ✅ COMPATIBLE |
| P6-05 does NOT import AlertTypes | ✅ COMPATIBLE |
| P6-05 creates own p6_warnings table | ✅ COMPATIBLE |
| Clean separation from P3 alert system | ✅ COMPATIBLE |

### Cross-Contract Verdict

**ALL CHECKS PASS. No contract violations. No semantic contradictions.**

---

## 10. INVARIANT AUDIT

### 10.1 Carry Forward: EW-01…EW-28

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
| EW-25 | Warning identity is occurrence-based | PASS |
| EW-26 | Severity is informational, not actionable | PASS |
| EW-27 | Dedup key includes detection window | PASS |
| EW-28 | Provenance references valid snapshot/regime IDs | PASS |

**28/28 PASS. 0 violations.**

### 10.2 New Invariants from Blocking Decisions

#### EW-29: Warning Vocabulary Is Closed
**Rule:** P6-05 MUST NOT introduce warning types beyond the 7 defined in PD-05B-01. New types require explicit Planner decision.
**Rationale:** Prevents scope creep and semantic drift.
**Boundary:** Exactly 7 warning types in V1.
**Validation:** No warning type values outside the defined vocabulary.

#### EW-30: Severity Is Strictly Ordinal
**Rule:** Severity levels MUST maintain strict ordering: INFO < LOW < MEDIUM < HIGH < CRITICAL. No level may be equivalent to another.
**Rationale:** Enables deterministic comparison and escalation detection.
**Boundary:** 5 levels, strict total order.
**Validation:** Severity comparison tests pass for all pairs.

#### EW-31: Threshold Configuration Is Versioned
**Rule:** All material change thresholds MUST be part of the warning version tuple (parameter_version). Changing thresholds MUST change the version.
**Rationale:** Ensures warnings generated with different thresholds are distinguishable and auditable.
**Boundary:** Thresholds are not hidden constants — they are explicit, versioned configuration.
**Validation:** Version changes when thresholds change.

#### EW-32: Lifecycle Transitions Are Deterministic
**Rule:** Same warning state + same input condition MUST produce the same lifecycle transition. No nondeterministic state changes.
**Rationale:** Enables reproducible lifecycle management.
**Boundary:** State machine is a pure function of current state + input.
**Validation:** Lifecycle determinism tests pass.

#### EW-33: Occurrence Identity Is Window-Scoped
**Rule:** Warning identity MUST include detection_window. Two warnings of the same type for the same entity in different windows MUST be distinct occurrences.
**Rationale:** Prevents cross-window suppression and enables full audit trail.
**Boundary:** Detection_window is part of identity tuple.
**Validation:** Same entity/type in different windows → different IDs.

#### EW-34: No Combined Severity Across Warning Types
**Rule:** Each warning type has independent severity. P6-05 MUST NOT combine or aggregate severity across warning types for the same entity.
**Rationale:** Warnings are independent informational records. Aggregation is P6-06 scope.
**Boundary:** One severity per warning record.
**Validation:** Multiple warnings for same entity have independent severities.

#### EW-35: Threshold Equality Is Inclusive
**Rule:** When a threshold specifies ≥ N, a value exactly equal to N MUST trigger the warning. Inclusive boundary.
**Rationale:** Consistent with P6-04 boundary semantics (PD-04C-01).
**Boundary:** ≥ means greater than or equal to.
**Validation:** Boundary tests for exact threshold values.

### 10.3 Total Invariant Count

| Source | Count |
|---|---|
| EW-01…EW-24 (P6-05B) | 24 |
| EW-25…EW-28 (P6-05C) | 4 |
| EW-29…EW-35 (P6-05C1) | 7 |
| **Total** | **35** |

---

## 11. PLANNER ACCEPTANCE GATE

### Gate: P6-05D Readiness

P6-05D (Implementation) can begin ONLY after Planner accepts ALL 6 blocking decisions below.

### Decision 1: PD-05B-01 — Warning Vocabulary

**Proposed:** 7 types
```
HEALTH_DETERIORATION
HEALTH_IMPROVEMENT
REGIME_CHANGE
REGIME_TRANSITION
CONFIDENCE_DETERIORATION
DATA_QUALITY_DEGRADATION
FRESHNESS_DEGRADATION
```

**Why required:** Determines warning engine scope, detection logic per type, dedup key composition, severity mapping.

**Downstream depends on it:**
- PD-05B-04 (per-type thresholds)
- PD-05B-07 (dedup key includes warning_type)
- All warning type-specific detection logic

---

### Decision 2: PD-05B-02 — Severity Vocabulary

**Proposed:** 5 ordinal levels
```
INFO < LOW < MEDIUM < HIGH < CRITICAL
```

**Why required:** Determines severity classification vocabulary, escalation detection, output format.

**Downstream depends on it:**
- PD-05B-03 (severity determination maps to these levels)
- PD-05B-09 (escalation = severity increase)
- All severity classification logic

---

### Decision 3: PD-05B-03 — Severity Determination

**Proposed:** Multi-factor model
```
Primary:   health_delta_magnitude (absolute points)
Secondary: regime_context (current regime state)
Tertiary:  confidence_context (warning confidence)
Context:   warning_type (baseline severity per type)
```

Tie-breaking: highest severity wins.

**Why required:** Determines how severity is calculated from inputs. Must be deterministic.

**Downstream depends on it:**
- All severity classification logic
- Escalation detection
- Warning output severity field

---

### Decision 4: PD-05B-04 — Material Change Thresholds

**Proposed:** Configurable with V1 defaults
```
Health delta:           ≥ 10 points (absolute)
Confidence drop:        ≥ 20 points (absolute)
Quality degradation:    Any INVALID/MISSING increase (qualitative)
Freshness degradation:  Any FRESH→STALE transition (qualitative)
Regime change:          Any confirmed transition (qualitative)
```

Thresholds are versioned (parameter_version in version tuple).

**Why required:** Determines the boundary between "material" and "immaterial" change. Affects warning frequency and noise.

**Downstream depends on it:**
- All warning generation logic
- Warning noise characteristics
- Cooldown interaction

---

### Decision 5: PD-05C-01 — Warning Identity

**Proposed:** Occurrence-based identity
```
identity = (entity_type, entity_id, warning_type, detection_window)
```

Each detection window produces a new warning record. Warnings are not reused across windows.

**Why required:** Determines dedup logic, persistence schema (unique constraint), lifecycle management, audit trail.

**Downstream depends on it:**
- PD-05B-07 (dedup key = identity)
- PD-05B-08 (cooldown operates on identity)
- PD-05B-14 (persistence unique constraint)
- All dedup, lifecycle, persistence logic

---

### Decision 6: PD-05B-10 — Warning Lifecycle

**Proposed:** 4 states (3 active + 1 terminal)
```
DETECTED → ACTIVE → RESOLVED (terminal)
                ↓
           SUPERSEDED (terminal)
```

ESCALATED removed. Escalation = new warning + old SUPERSEDED.

**Why required:** Determines state machine, persistence status values, resolution detection, supersession logic.

**Downstream depends on it:**
- PD-05B-09 (escalation subsumed by lifecycle)
- PD-05B-14 (persistence status column)
- All lifecycle management logic

---

## 12. ACCEPTANCE FORMAT

Planner should respond with:

```
PD-05B-01: ACCEPT / REJECT / MODIFY
PD-05B-02: ACCEPT / REJECT / MODIFY
PD-05B-03: ACCEPT / REJECT / MODIFY
PD-05B-04: ACCEPT / REJECT / MODIFY
PD-05C-01: ACCEPT / REJECT / MODIFY
PD-05B-10: ACCEPT / REJECT / MODIFY
```

If REJECT or MODIFY: specify alternative resolution.

---

## 13. NON-BLOCKING DECISIONS (Safe Defaults)

These decisions use documented V1 defaults and do NOT require explicit Planner acceptance:

| ID | Decision | V1 Default |
|---|---|---|
| PD-05B-05 | Quality role | Metadata only |
| PD-05B-06 | Freshness role | Metadata only |
| PD-05B-07 | Dedup key | (entity_type, entity_id, warning_type, detection_window) |
| PD-05B-08 | Cooldown | 24 hours |
| PD-05B-09 | Escalation | New warning + old SUPERSEDED |
| PD-05B-11 | Provenance depth | Full chain |
| PD-05B-12 | Version tuple | Standalone (algorithm, parameter, schema, config_hash) |
| PD-05B-13 | Coin/narrative parity | Same model |
| PD-05B-14 | Persistence | Append-only (never DELETE, status UPDATE permitted) |
| PD-05C-03 | Comparison mechanism | Both snapshot and regime |
| PD-05C-04 | Previous snapshot | Most recent SUPERSEDED |
| PD-05C-05 | Multiple warnings/event | YES |
| PD-05C-07 | detection_window source | snapshot window_end |
| PD-05C-09 | Cooldown reset | On escalation |
| PD-05C-12 | Append-only meaning | Never DELETE, UPDATE OK |
| PD-05C-14 | Warning confidence | = regime confidence at detection |
| PD-05C-15 | Confidence immutability | Set at detection, immutable |
| PD-05C-16 | Threshold storage | Config object, versioned |
| PD-05C-17 | Per-entity thresholds | NO — global |
| PD-05C-18 | detection_window | = snapshot window_end |
| PD-05C-19 | Multi-window lookback | NO — V1 current vs previous only |
| PD-05C-20 | Refresh integration | Synchronous after P6-04 |

---

## 14. DEFERRED DECISIONS

| ID | Decision | Reason |
|---|---|---|
| PD-05C-13 | Retention policy | P6-08 scope |
| EG-01 | P6-06 integration | P6-06 scope |
| EG-02 | P6-07 UI | P6-07 scope |
| EG-03…06 | Production tuning | Needs production data |

---

## 15. EVIDENCE GAPS

| Gap | Impact | Blocking | Status |
|---|---|---|---|
| P6-06 integration | P6-06 scope | NO | DEFERRED |
| P6-07 UI | P6-07 scope | NO | DEFERRED |
| Production warning volume | Threshold tuning | NO | Needs production data |
| Warning noise rate | Cooldown tuning | NO | Needs production feedback |
| Cooldown effectiveness | Dedup behavior | NO | Needs production testing |
| Severity accuracy | Severity rules | NO | Needs production validation |

**0 blocking evidence gaps.**

---

## 16. CONCLUSION

P6-05C1 presents **6 blocking decisions** for Planner acceptance:

1. **PD-05B-01:** 7 warning types
2. **PD-05B-02:** 5 severity levels (INFO/LOW/MEDIUM/HIGH/CRITICAL)
3. **PD-05B-03:** Multi-factor severity determination
4. **PD-05B-04:** Configurable thresholds with V1 defaults
5. **PD-05C-01:** Occurrence-based warning identity
6. **PD-05B-10:** 4-state lifecycle (DETECTED/ACTIVE/RESOLVED/SUPERSEDED)

Accepting these 6 decisions resolves **19 of 20** implicit decisions. Only retention (PD-05C-13) remains deferred to P6-08.

**Cross-contract audit:** ALL CHECKS PASS. No violations with P6-01/02/03/04/P4/P5.

**Invariant coverage:** 35 invariants (EW-01…EW-35). All PASS.

**All decisions remain PROPOSED.** Planner acceptance is required before P6-05D implementation.

---

**Git Boundary:** ✅ Documentation only. No production code modified.
