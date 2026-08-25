# P6-05B — Early Warning Semantic Contract

## 1. Executive Summary

P6-05 is the **Early Warning Engine** — the layer that transforms material changes in P6 intelligence into structured, deduplicated, severity-classified warnings.

This contract defines:
- Warning domain model
- Warning vocabulary (PROPOSED, not frozen)
- Severity semantics (PROPOSED, not frozen)
- Material change detection semantics
- Quality/freshness interaction
- Deduplication semantics
- Warning lifecycle
- Provenance chain
- Versioning model
- Determinism requirements
- Coin/narrative symmetry
- Persistence boundary
- P4/P5 boundary invariants
- 24 invariants (EW-01…EW-24)
- 14 Planner decisions (PD-05B-01…14)
- 6 evidence gaps

**All decisions are PROPOSED. None are frozen.**

## 2. Scope

P6-05 consumes P6-native outputs and produces warnings.

```
P6-01 Observation → P6-02 Feature → P6-03 Snapshot → P6-04 Regime → P6-05 Warning
```

### What P6-05 IS

A structured warning generator that:
- Monitors material changes across the P6 pipeline
- Produces severity-classified warnings with evidence
- Deduplicates and manages warning lifecycle
- Preserves full provenance chain

### What P6-05 Is NOT

- ❌ Decision engine
- ❌ Action engine
- ❌ BUY/SELL signal
- ❌ P5 bridge
- ❌ Policy engine
- ❌ Approval engine
- ❌ Trade execution engine
- ❌ Intelligence aggregation (that's P6-06)
- ❌ UI/dashboard (that's P6-07)

## 3. Non-Goals

- No recommendation semantics
- No action priority
- No user acknowledgement workflow (V1)
- No cross-entity correlation (V2)
- No narrative intelligence aggregation (P6-06 scope)
- No historical backfill (P6-08 scope)

## 4. Architectural Position

P6-05 sits between regime detection (P6-04) and intelligence aggregation (P6-06).

| Layer | Input | Output |
|---|---|---|
| P6-01 | Raw data | Canonical observations |
| P6-02 | Observations | Derived features |
| P6-03 | Features | Intelligence snapshots |
| P6-04 | Snapshots | Regime states |
| **P6-05** | **Regimes + Snapshots + Features** | **Warnings** |
| P6-06 | Warnings + Regimes + Snapshots | Intelligence summary |
| P6-07 | Intelligence summary | UI |
| P6-08 | Historical data | Backfill |
| P6-09 | All layers | Verification |

## 5. Warning Domain Model

### 5.1 Warning Identity

A warning is identified by:

```
(entity_type, entity_id, warning_type, detection_window)
```

Where:
- `entity_type`: "coin" | "narrative"
- `entity_id`: numeric entity identifier
- `warning_type`: warning classification (see §6)
- `detection_window`: the time window during which the material change was detected

### 5.2 Warning Record

| Field | Type | Description |
|---|---|---|
| `id` | integer PK | Unique identifier |
| `entity_type` | varchar(20) | "coin" \| "narrative" |
| `entity_id` | integer | Entity identifier |
| `warning_type` | varchar(30) | Warning classification |
| `severity` | varchar(20) | Severity level |
| `status` | varchar(20) | Lifecycle state |
| `message` | text | Human-readable description |
| `reason` | text | Why this warning was generated |
| `health_score` | real | Current health score at detection |
| `previous_health_score` | real \| null | Previous health score for comparison |
| `health_delta` | real \| null | Change in health score |
| `regime_state` | varchar(30) | Current regime at detection |
| `previous_regime_state` | varchar(30) \| null | Previous regime state |
| `confidence` | real | Warning confidence (0-100) |
| `dedup_key` | text | Deduplication key |
| `quality_metadata` | jsonb | Quality snapshot at detection |
| `freshness_metadata` | jsonb | Freshness snapshot at detection |
| `evidence` | jsonb | Evidence references |
| `version` | jsonb | Warning version tuple |
| `provenance` | jsonb | Full provenance chain |
| `detected_at` | timestamp | When warning was generated |
| `effective_from` | timestamp | When the material change started |
| `effective_until` | timestamp \| null | When the warning was resolved |
| `superseded_at` | timestamp \| null | When replaced by newer warning |
| `created_at` | timestamp | Record creation |

### 5.3 Warning vs Snapshot vs Regime

| Concept | P6-03 Snapshot | P6-04 Regime | P6-05 Warning |
|---|---|---|---|
| Purpose | Point-in-time health score | Health regime classification | Material change notification |
| Temporal | Single calculation time | Current + previous state | Event-driven detection |
| Identity | (entity, type, window_end) | (entity, regime_type, status) | (entity, type, detection_window) |
| Lifecycle | CURRENT / SUPERSEDED | CURRENT / SUPERSEDED | DETECTED → ACTIVE → RESOLVED |
| Vocabulary | Score 0-100 | STRONG/STABLE/WEAK/... | WARNING_TYPE + SEVERITY |

## 6. Warning Vocabulary

### 6.1 Warning Types (PROPOSED — PD-05B-01)

| Warning Type | Trigger | V1 Scope |
|---|---|---|
| `HEALTH_DETERIORATION` | Health score drops materially | ✅ V1 |
| `HEALTH_IMPROVEMENT` | Health score rises materially | ✅ V1 |
| `REGIME_CHANGE` | Regime state changes | ✅ V1 |
| `REGIME_TRANSITION` | Regime enters TRANSITIONING | ✅ V1 |
| `CONFIDENCE_DETERIORATION` | Regime confidence drops materially | ✅ V1 |
| `DATA_QUALITY_DEGRADATION` | Quality metadata degrades | ✅ V1 |
| `FRESHNESS_DEGRADATION` | Freshness metadata degrades | ✅ V1 |

**Deferred to V2:**
- `CONSECUTIVE_CHANGE` — N consecutive same-direction changes
- `CROSS_ENTITY_DIVERGENCE` — coin vs narrative divergence
- `ANOMALY` — statistical anomaly detection

### 6.2 Warning Type Semantics

Each warning type has specific trigger semantics:

**HEALTH_DETERIORATION:**
- Trigger: health_score drops by ≥ threshold from previous snapshot
- Evidence: previous_score, current_score, delta
- Severity: based on delta magnitude and regime context

**HEALTH_IMPROVEMENT:**
- Trigger: health_score rises by ≥ threshold from previous snapshot
- Evidence: previous_score, current_score, delta
- Severity: based on delta magnitude and regime context

**REGIME_CHANGE:**
- Trigger: P6-04 regime state changes (not TRANSITIONING)
- Evidence: previous_regime, current_regime, regime_confidence
- Severity: based on direction and magnitude of change

**REGIME_TRANSITION:**
- Trigger: P6-04 regime enters TRANSITIONING state
- Evidence: previous_regime, target_regime, transition_confidence
- Severity: based on target regime and confidence

**CONFIDENCE_DETERIORATION:**
- Trigger: regime confidence drops by ≥ threshold
- Evidence: previous_confidence, current_confidence, delta
- Severity: based on delta magnitude

**DATA_QUALITY_DEGRADATION:**
- Trigger: quality_metadata shows degradation (more INVALID/MISSING)
- Evidence: quality_before, quality_after, affected_snapshots
- Severity: based on degradation magnitude

**FRESHNESS_DEGRADATION:**
- Trigger: freshness_metadata shows staleness increase
- Evidence: freshness_before, freshness_after, stale_count
- Severity: based on staleness magnitude

## 7. Severity Semantics

### 7.1 Severity Levels (PROPOSED — PD-05B-02)

| Level | Meaning | V1 Scope |
|---|---|---|
| `INFO` | Informational change, no action needed | ✅ V1 |
| `LOW` | Minor change, monitoring suggested | ✅ V1 |
| `MEDIUM` | Notable change, attention recommended | ✅ V1 |
| `HIGH` | Significant change, immediate attention | ✅ V1 |
| `CRITICAL` | Severe change, urgent attention | ✅ V1 |

### 7.2 Severity Determination (PROPOSED — PD-05B-03)

Severity is determined by a combination of:

| Factor | Weight | Evidence |
|---|---|---|
| Health delta magnitude | Primary | Score change amount |
| Regime context | Secondary | Current regime state |
| Confidence | Tertiary | Warning confidence |
| Direction | Modifier | Deterioration vs improvement |

**Severity is NOT:**
- Action priority (no recommendation semantics)
- Trading signal
- Policy trigger
- Approval requirement

### 7.3 Severity Precedence (PROPOSED)

When multiple factors apply, the highest severity wins:
```
INFO < LOW < MEDIUM < HIGH < CRITICAL
```

### 7.4 Severity is Deterministic (PROPOSED)

Same inputs + same versions → same severity. No randomness, no external state.

## 8. Material Change Semantics

### 8.1 What Is a Material Change?

A material change is a change in P6 pipeline output that exceeds a defined threshold and warrants a warning.

### 8.2 Material Change Triggers (PROPOSED — PD-05B-04)

| Trigger | Threshold | Evidence |
|---|---|---|
| Health score delta | ≥ 10 points (configurable) | P6-03 snapshot comparison |
| Regime state change | Any state change | P6-04 regime transition |
| Confidence drop | ≥ 20 points (configurable) | P6-04 confidence comparison |
| Quality degradation | Any INVALID/MISSING increase | P6-03 quality metadata |
| Freshness degradation | Any FRESH→STALE transition | P6-03 freshness metadata |

### 8.3 State Change vs Material Change vs Warning

| Concept | Definition |
|---|---|
| State change | Any difference between current and previous output |
| Material change | State change that exceeds defined threshold |
| Warning | Material change that has been classified and deduplicated |

P6-05 converts state changes → material changes → warnings.

### 8.4 Regime Change Warning Semantics

When P6-04 detects a regime change:
- P6-05 generates a `REGIME_CHANGE` warning
- Severity based on direction and magnitude
- Evidence includes regime transition details
- P6-05 does NOT reinterpret the regime change

### 8.5 Health Change Warning Semantics

When P6-03 snapshot shows health score change:
- P6-05 compares current vs previous snapshot
- If delta exceeds threshold, generates `HEALTH_DETERIORATION` or `HEALTH_IMPROVEMENT`
- Severity based on delta magnitude
- P6-05 does NOT reinterpret the health score

## 9. Quality Semantics

### 9.1 Quality Vocabulary (FROZEN — P6-01)

```
VALID | INVALID | MISSING | UNKNOWN
```

No new QualityState. P6-05 preserves existing vocabulary.

### 9.2 Quality Interaction with Warnings

| Scenario | Warning Behavior |
|---|---|
| VALID input | Normal warning generation |
| INVALID input | Warning may be generated with quality metadata noting INVALID |
| MISSING input | Warning may be generated with quality metadata noting MISSING |
| UNKNOWN input | Warning may be generated with quality metadata noting UNKNOWN |
| Quality degradation | `DATA_QUALITY_DEGRADATION` warning type |

### 9.3 Quality Is Metadata (PROPOSED — PD-05B-05)

Quality metadata is:
- ✅ Preserved in warning provenance
- ✅ Available for downstream consumption
- ❌ NOT used to suppress warnings
- ❌ NOT used to determine severity
- ❌ NOT converted to severity levels

### 9.4 Infrastructure Failure ≠ Quality State (PROPOSED)

Persistence/infrastructure failure:
- ❌ Does NOT become UNKNOWN
- ❌ Does NOT become a warning
- ❌ Is NOT converted to quality metadata
- ✅ Is logged and returned as null/error

## 10. Freshness Semantics

### 10.1 Freshness Vocabulary (FROZEN — P6-01)

```
FRESH | STALE | UNKNOWN
```

### 10.2 Freshness Interaction with Warnings

| Scenario | Warning Behavior |
|---|---|
| FRESH input | Normal warning generation |
| STALE input | Warning may be generated with freshness metadata noting STALE |
| UNKNOWN freshness | Warning may be generated with freshness metadata noting UNKNOWN |
| Freshness degradation | `FRESHNESS_DEGRADATION` warning type |

### 10.3 Freshness Is Independent (PROPOSED — PD-05B-06)

Freshness is:
- ✅ Preserved as metadata
- ✅ Available for downstream consumption
- ❌ NOT used to suppress warnings
- ❌ NOT used to determine severity
- ❌ NOT converted to quality states
- ❌ NOT weighted in V1

### 10.4 STALE ≠ INVALID (PROPOSED)

STALE is a freshness condition, not a quality condition:
- STALE data may still be valid
- STALE data may still generate useful warnings
- STALE does not imply INVALID
- STALE does not suppress warnings

## 11. Deduplication

### 11.1 Deduplication Key (PROPOSED — PD-05B-07)

The deduplication key identifies unique warnings:

```
(entity_type, entity_id, warning_type, detection_window)
```

Where `detection_window` is the time window during which the material change was detected (typically aligned with the snapshot/calculation cycle).

### 11.2 Deduplication Semantics (PROPOSED — PD-05B-08)

| Scenario | Behavior |
|---|---|
| Same warning in same window | Suppressed (duplicate) |
| Same warning in new window | New warning (recurrence) |
| Severity escalation | New warning with higher severity |
| Severity de-escalation | New warning with lower severity |
| Warning resolved | Status → RESOLVED |
| Warning reactivated | Status → ACTIVE (new occurrence) |

### 11.3 Cooldown (PROPOSED — PD-05B-09)

After a warning is generated:
- Same warning type for same entity is suppressed for cooldown period
- Cooldown period: configurable (V1 default: 24 hours)
- Cooldown applies per (entity_type, entity_id, warning_type)
- Cooldown does NOT apply across different warning types

### 11.4 Deduplication Is Deterministic (PROPOSED)

Same inputs + same dedup state → same dedup result. No randomness, no external state.

## 12. Warning Lifecycle

### 12.1 Lifecycle States (PROPOSED — PD-05B-10)

```
DETECTED → ACTIVE → RESOLVED
                ↓
           ESCALATED → ACTIVE
                ↓
           SUPERSEDED
```

| State | Meaning |
|---|---|
| `DETECTED` | Warning just generated, not yet persisted |
| `ACTIVE` | Warning is current and visible |
| `ESCALATED` | Warning severity increased |
| `RESOLVED` | Material change no longer present |
| `SUPERSEDED` | Replaced by newer warning for same entity/type |

### 12.2 Lifecycle ≠ QualityState (PROPOSED — EW-11)

Warning lifecycle states are NOT QualityState:
- DETECTED ≠ INVALID
- ACTIVE ≠ VALID
- RESOLVED ≠ MISSING
- SUPERSEDED ≠ UNKNOWN

### 12.3 Lifecycle ≠ RegimeState (PROPOSED)

Warning lifecycle states are NOT RegimeState:
- ACTIVE ≠ STRONG/STABLE/WEAK
- ESCALATED ≠ TRANSITIONING

### 12.4 Lifecycle ≠ SnapshotStatus (PROPOSED)

Warning lifecycle states are NOT SnapshotStatus:
- ACTIVE ≠ CURRENT
- SUPERSEDED ≈ SUPERSEDED (similar concept, different entity)

## 13. Provenance

### 13.1 Provenance Chain (PROPOSED — PD-05B-11)

```
Warning
  → Trigger Event (material change detection)
    → P6-04 Regime State
      → P6-03 Snapshot
        → P6-02 Feature
          → P6-01 Observation
```

### 13.2 Minimum Provenance (PROPOSED)

A warning must contain:
- Source layer: "P6-05"
- Source entity: (entity_type, entity_id)
- Source record: warning id
- Input snapshot identity: (entity, type, window_end)
- Input regime identity: (entity, regime_type, status)
- Regime state at detection
- Health score at detection
- Quality metadata at detection
- Freshness metadata at detection
- Calculation/version tuple
- Detection timestamp
- Window boundary

### 13.3 Provenance Is Metadata (PROPOSED)

Provenance:
- ✅ Is preserved in warning record
- ✅ Is traceable through the full chain
- ❌ Does NOT influence warning generation
- ❌ Does NOT influence severity determination

## 14. Versioning

### 14.1 Warning Version Tuple (PROPOSED — PD-05B-12)

```typescript
interface WarningVersionTuple {
  readonly algorithm_version: string;    // "p6-warning-v1"
  readonly parameter_version: string;    // threshold config version
  readonly schema_version: string;       // "v1"
  readonly config_hash: string;          // hash of active configuration
}
```

### 14.2 Version Separation (PROPOSED)

Each P6 layer has its own version:
- P6-01: observation version
- P6-02: feature version
- P6-03: snapshot version
- P6-04: regime version
- **P6-05: warning version** (standalone)

Warning version does NOT inherit from or override other layer versions.

### 14.3 Version Change Semantics (PROPOSED)

When warning algorithm/parameters change:
- New warning version tuple is recorded
- Existing warnings are NOT retroactively recalculated
- New calculations use new version
- Historical warnings retain their original version

## 15. Determinism

### 15.1 Determinism Requirement (PROPOSED — EW-16)

```
same inputs + same versions + same configuration + same dedup state
  = same warning result
```

### 15.2 Deterministic Ordering (PROPOSED)

When processing multiple entities or warning types:
- Process in deterministic order (entity_id ascending)
- No Set/Map iteration order dependency
- No random number generation
- No live external data dependency

### 15.3 Timestamp Semantics (PROPOSED)

- `detected_at`: calculation timestamp (deterministic from input)
- `effective_from`: when the material change started (from input data)
- `effective_until`: when resolved (from later comparison)
- No wall-clock dependency for classification

## 16. Coin/Narrative Symantics

### 16.1 Same Model (PROPOSED — PD-05B-13)

P6-05 uses the same warning model for:
- Coins (entity_type = "coin")
- Narratives (entity_type = "narrative")

### 16.2 Narrative Warning Scope (PROPOSED)

Narrative warnings are generated from:
- Narrative health score changes (P6-03 narrative snapshot)
- Narrative regime changes (P6-04 narrative regime)

Narrative warnings do NOT:
- Aggregate coin-level warnings
- Cross-reference coin and narrative warnings
- Create cross-entity correlation warnings (V2)

### 16.3 Coin/Narrative Parity (PROPOSED)

Same inputs + same entity_type difference → same warning behavior. No entity-specific hidden rules.

## 17. Persistence Boundary

### 17.1 Persistence Model (PROPOSED — PD-05B-14)

P6-05 uses a new table: `p6_warnings`

| Semantics | Behavior |
|---|---|
| Insert | New warning generated |
| Update | Status change (ACTIVE→RESOLVED, etc.) |
| Latest-only | No — full history retained |
| Append-only | Yes — warnings are never deleted |
| Idempotent | Same dedup_key → no duplicate insert |

### 17.2 Persistence ≠ Quality State (PROPOSED — EW-20)

Persistence failure:
- ❌ Does NOT become a warning
- ❌ Does NOT become UNKNOWN
- ❌ Is NOT swallowed silently
- ✅ Is logged and returned as error

### 17.3 Schema Boundary (PROPOSED)

P6-05 schema is additive only:
- New `p6_warnings` table
- No modification to existing tables
- No modification to P4/P5 tables
- No modification to P6-01/02/03/04 tables

## 18. P4/P5 Boundary

### 18.1 Invariants

| Invariant | Rule |
|---|---|
| EW-21 | P6-05 does NOT modify P4 |
| EW-22 | P6-05 does NOT modify P5 |
| EW-23 | P6-05 does NOT create BUY/SELL semantics |
| EW-24 | P6-05 does NOT create action/policy/approval semantics |

### 18.2 P4 Consumer Boundary

P4 reads from P3/P2, not from P6-05. P6-05 warnings are:
- ✅ Available for P6-06 aggregation
- ✅ Available for P6-07 UI
- ❌ NOT consumed by P4 interpretation
- ❌ NOT consumed by P5 policy

### 18.3 P5 Replay Boundary

P6-05 warnings are:
- ❌ NOT part of P5 replay artifact chain
- ❌ NOT stored in P5 artifact tables
- ✅ Stored in P6-05 own persistence
- ✅ Independent of P5 replay

## 19. Invariants

### EW-01: Input Authority
**Rule:** P6-05 MUST consume only P6-native outputs (P6-02 features, P6-03 snapshots, P6-04 regimes).
**Rationale:** Prevents legacy contamination and ensures data authority chain.
**Boundary:** No `market_price_daily`, `coin_metrics`, `health_scores`, `morning_snapshots`, `indicators` as semantic source.
**Validation:** No legacy table imports in P6-05 modules.

### EW-02: No Action Semantics
**Rule:** P6-05 warnings MUST NOT be interpreted as actions, recommendations, BUY/SELL signals, or policy triggers.
**Rationale:** P6-05 observes and reports; P5 decides and acts.
**Boundary:** Warning output contains no action/recommendation fields.
**Validation:** No BUY/SELL/action/policy code in P6-05 modules.

### EW-03: Quality Vocabulary Unchanged
**Rule:** P6-05 MUST NOT introduce new QualityState values. Quality remains: VALID | INVALID | MISSING | UNKNOWN.
**Rationale:** P6-01 quality vocabulary is frozen.
**Boundary:** Quality metadata preserved, not extended.
**Validation:** No new QualityState values in P6-05 types.

### EW-04: Freshness Independent
**Rule:** Freshness (FRESH/STALE/UNKNOWN) MUST be preserved as metadata and MUST NOT be converted to quality states, severity levels, or warning suppression.
**Rationale:** Freshness is an independent dimension per P6-01.
**Boundary:** Freshness metadata preserved, not reinterpreted.
**Validation:** No freshness→severity or freshness→quality conversion.

### EW-05: Warning ≠ QualityState
**Rule:** Warning states (DETECTED, ACTIVE, RESOLVED, etc.) MUST NOT be confused with QualityState.
**Rationale:** Different semantic domains.
**Boundary:** Separate type systems.
**Validation:** No QualityState values in warning lifecycle.

### EW-06: Warning ≠ RegimeState
**Rule:** Warning states MUST NOT be confused with RegimeState (STRONG/STABLE/WEAK/TRANSITIONING/INSUFFICIENT_DATA/UNKNOWN).
**Rationale:** Different semantic domains.
**Boundary:** Separate type systems.
**Validation:** No RegimeState values in warning lifecycle.

### EW-07: Warning ≠ SnapshotStatus
**Rule:** Warning states MUST NOT be confused with SnapshotStatus (CURRENT/SUPERSEDED).
**Rationale:** Different semantic domains.
**Boundary:** Separate type systems.
**Validation:** No SnapshotStatus values in warning lifecycle.

### EW-08: Material Change Is Deterministic
**Rule:** Same inputs + same versions + same configuration MUST produce same material change determination.
**Rationale:** Determinism enables reproducibility and debugging.
**Boundary:** No randomness, no external state dependency.
**Validation:** Determinism tests pass.

### EW-09: Deduplication Is Deterministic
**Rule:** Same inputs + same dedup state MUST produce same dedup result.
**Rationale:** Determinism enables reproducibility.
**Boundary:** No randomness, no external state dependency.
**Validation:** Idempotency tests pass.

### EW-10: Severity Is Deterministic
**Rule:** Same inputs + same versions + same configuration MUST produce same severity.
**Rationale:** Determinism enables reproducibility.
**Boundary:** No randomness, no external state dependency.
**Validation:** Determinism tests pass.

### EW-11: Lifecycle ≠ QualityState
**Rule:** Warning lifecycle states MUST NOT be interpreted as QualityState values.
**Rationale:** Different semantic domains.
**Boundary:** Separate type systems.
**Validation:** No QualityState values in warning lifecycle.

### EW-12: Provenance Is Complete
**Rule:** Every warning MUST contain provenance tracing to P6-04 regime, P6-03 snapshot, P6-02 feature, and P6-01 observation.
**Rationale:** Full traceability is required.
**Boundary:** Provenance is metadata, not classification input.
**Validation:** Provenance completeness tests pass.

### EW-13: Provenance Is Immutable
**Rule:** Once a warning is persisted, its provenance MUST NOT change.
**Rationale:** Historical integrity.
**Boundary:** Provenance set at detection, never modified.
**Validation:** No provenance mutation after persistence.

### EW-14: Version Separation
**Rule:** Warning version tuple MUST be separate from feature, snapshot, and regime version tuples.
**Rationale:** Each layer has independent versioning.
**Boundary:** No version inheritance or override.
**Validation:** Warning version is standalone.

### EW-15: Coin/Narrative Symmetry
**Rule:** Same warning model applies to coins and narratives. No entity-specific hidden rules.
**Rationale:** Consistency and predictability.
**Boundary:** Entity type is a parameter, not a behavioral fork.
**Validation:** Parity tests pass.

### EW-16: Deterministic Ordering
**Rule:** Processing multiple entities/warnings MUST use deterministic ordering (entity_id ascending).
**Rationale:** Reproducibility.
**Boundary:** No Set/Map iteration dependency.
**Validation:** Ordering tests pass.

### EW-17: P4/P5 Untouched
**Rule:** P6-05 MUST NOT modify any P4 or P5 contract, implementation, or behavior.
**Rationale:** P4/P5 are frozen.
**Boundary:** No P4/P5 code imports or modifications.
**Validation:** P4/P5 regression tests pass.

### EW-18: No P5 Replay Contamination
**Rule:** P6-05 warnings MUST NOT be inserted into P5 replay artifact chain.
**Rationale:** P5 replay is independent.
**Boundary:** Separate persistence.
**Validation:** No P5 artifact table writes.

### EW-19: Infrastructure Failure ≠ Warning
**Rule:** Persistence/infrastructure failure MUST NOT become a warning, QualityState, or RegimeState.
**Rationale:** Infrastructure failures are operational, not semantic.
**Boundary:** Errors logged, not converted.
**Validation:** Error boundary tests pass.

### EW-20: Persistence ≠ Quality State
**Rule:** Persistence failure MUST NOT become UNKNOWN or any quality condition.
**Rationale:** Infrastructure failure is separate from data quality.
**Boundary:** Errors returned as null/error.
**Validation:** Persistence failure tests pass.

### EW-21: P4 Not Modified
**Rule:** P6-05 MUST NOT modify P4 contracts or implementation.
**Rationale:** P4 is frozen.
**Boundary:** No P4 code changes.
**Validation:** P4 regression tests pass.

### EW-22: P5 Not Modified
**Rule:** P6-05 MUST NOT modify P5 contracts or implementation.
**Rationale:** P5 is frozen.
**Boundary:** No P5 code changes.
**Validation:** P5 regression tests pass.

### EW-23: No BUY/SELL Semantics
**Rule:** P6-05 warnings MUST NOT contain BUY/SELL, trading, or execution semantics.
**Rationale:** P6-05 observes, P5 acts.
**Boundary:** Warning output is informational only.
**Validation:** No BUY/SELL fields in warning types.

### EW-24: No Action/Policy/Approval Semantics
**Rule:** P6-05 warnings MUST NOT contain action, policy, or approval semantics.
**Rationale:** P6-05 observes, downstream layers decide.
**Boundary:** Warning output is informational only.
**Validation:** No action/policy fields in warning types.

## 20. Planner Decision Inventory

### PD-05B-01: Warning Vocabulary
**Question:** What warning types exist in V1?
**Evidence:** P6-05A recon identified 7 candidate types.
**Options:** 3 types / 5 types / 7 types
**Recommended V1:** 7 types (HEALTH_DETERIORATION, HEALTH_IMPROVEMENT, REGIME_CHANGE, REGIME_TRANSITION, CONFIDENCE_DETERIORATION, DATA_QUALITY_DEGRADATION, FRESHNESS_DEGRADATION)
**Blocking:** YES — determines warning engine scope
**Dependency:** None

### PD-05B-02: Severity Vocabulary
**Question:** What severity levels exist in V1?
**Evidence:** P6 master spec mentions INFO/WATCH/WARNING/CRITICAL.
**Options:** 3 levels / 4 levels / 5 levels
**Recommended V1:** 5 levels (INFO, LOW, MEDIUM, HIGH, CRITICAL)
**Blocking:** YES — determines severity rules
**Dependency:** PD-05B-01

### PD-05B-03: Severity Determination
**Question:** How is severity determined?
**Evidence:** P6-05A identified health delta, regime context, confidence as factors.
**Options:** Health delta only / Multi-factor / Configurable
**Recommended V1:** Multi-factor with health delta as primary
**Blocking:** YES — determines severity rules
**Dependency:** PD-05B-02

### PD-05B-04: Material Change Thresholds
**Question:** What thresholds trigger warnings?
**Evidence:** P6-05A identified health score delta, regime change, confidence drop.
**Options:** Fixed thresholds / Configurable / Adaptive
**Recommended V1:** Configurable with sensible defaults
**Blocking:** YES — determines warning generation
**Dependency:** PD-05B-01

### PD-05B-05: Quality Metadata Role
**Question:** How does quality metadata interact with warnings?
**Evidence:** P6-01 quality vocabulary frozen. P6-05A recommends metadata-only.
**Options:** Metadata only / Gating / Weighting / Suppression
**Recommended V1:** Metadata only — quality preserved, not used for classification
**Blocking:** NO — safe default identified
**Dependency:** P6-01 frozen contract

### PD-05B-06: Freshness Metadata Role
**Question:** How does freshness metadata interact with warnings?
**Evidence:** P6-01 freshness vocabulary frozen. P6-05A recommends metadata-only.
**Options:** Metadata only / Gating / Weighting / Suppression
**Recommended V1:** Metadata only — freshness preserved, not used for classification
**Blocking:** NO — safe default identified
**Dependency:** P6-01 frozen contract

### PD-05B-07: Deduplication Key
**Question:** What uniquely identifies a warning for deduplication?
**Evidence:** P6-05A proposed (entity_type, entity_id, warning_type, detection_window).
**Options:** Simple key / Complex key / Composite key
**Recommended V1:** (entity_type, entity_id, warning_type, detection_window)
**Blocking:** YES — determines dedup behavior
**Dependency:** PD-05B-01

### PD-05B-08: Deduplication Window
**Question:** How long is a warning suppressed after generation?
**Evidence:** P6-05A proposed 24-hour cooldown.
**Options:** 12 hours / 24 hours / 48 hours / Configurable
**Recommended V1:** 24 hours, configurable
**Blocking:** NO — safe default identified
**Dependency:** PD-05B-07

### PD-05B-09: Escalation Semantics
**Question:** How are severity escalations handled?
**Evidence:** P6-05A identified escalation as needed.
**Options:** New warning / Update existing / Both
**Recommended V1:** New warning with higher severity, old warning SUPERSEDED
**Blocking:** NO — safe default identified
**Dependency:** PD-05B-02

### PD-05B-10: Warning Lifecycle
**Question:** What lifecycle states exist?
**Evidence:** P6-05A proposed DETECTED/ACTIVE/RESOLVED/ESCALATED/SUPERSEDED.
**Options:** 3 states / 4 states / 5 states
**Recommended V1:** 5 states (DETECTED, ACTIVE, ESCALATED, RESOLVED, SUPERSEDED)
**Blocking:** YES — determines lifecycle behavior
**Dependency:** PD-05B-09

### PD-05B-11: Provenance Depth
**Question:** How deep must provenance trace?
**Evidence:** P6-05A recommended full chain.
**Options:** Warning only / Warning + regime / Full chain
**Recommended V1:** Full chain (warning → regime → snapshot → feature → observation)
**Blocking:** NO — safe default identified
**Dependency:** P6-01/02/03/04 frozen contracts

### PD-05B-12: Warning Version Tuple
**Question:** What does the warning version tuple contain?
**Evidence:** P6-05A recommended standalone version.
**Options:** Reuse regime version / Standalone version
**Recommended V1:** Standalone (algorithm_version, parameter_version, schema_version, config_hash)
**Blocking:** NO — safe default identified
**Dependency:** None

### PD-05B-13: Coin/Narrative Parity
**Question:** Do coins and narratives use the same warning model?
**Evidence:** P6-05A recommended same model.
**Options:** Same model / Different models / Hybrid
**Recommended V1:** Same model, entity_type as parameter
**Blocking:** NO — safe default identified
**Dependency:** None

### PD-05B-14: Persistence Model
**Question:** What persistence model for warnings?
**Evidence:** P6-05A recommended append-only with status updates.
**Options:** Latest-only / Append-only / Hybrid
**Recommended V1:** Append-only (warnings never deleted, status updated)
**Blocking:** YES — determines schema design
**Dependency:** PD-05B-10

## 21. Evidence & Gap Audit

### Evidence Status

| Evidence | Status | Source |
|---|---|---|
| P6-05 scope definition | CONFIRMED | P6 master specification |
| P6-05 pipeline position | CONFIRMED | P6-05A recon |
| P6-05 input sources | CONFIRMED | P6-05A recon |
| P6-05 output structure | CONFIRMED | P6-05A recon |
| P4/P5 boundary | CONFIRMED | P6-04-FINAL audit |
| Quality vocabulary | CONFIRMED | P6-01 frozen contract |
| Freshness vocabulary | CONFIRMED | P6-01 frozen contract |
| Regime vocabulary | CONFIRMED | P6-04 frozen contract |
| Snapshot types | CONFIRMED | P6-03 frozen contract |
| Legacy alert patterns | INFERRED | alertRules/alertHistory schema |
| Material change thresholds | INFERRED | P6-05A candidate decisions |
| Severity determination | INFERRED | P6-05A candidate decisions |
| Dedup window duration | INFERRED | P6-05A candidate decisions |
| Escalation behavior | INFERRED | P6-05A candidate decisions |
| Warning→P6-06 integration | MISSING EVIDENCE | P6-06 scope |
| Warning→P6-07 UI | MISSING EVIDENCE | P6-07 scope |
| Production warning volume | MISSING EVIDENCE | Needs production data |
| Warning noise rate | MISSING EVIDENCE | Needs production feedback |
| Cooldown effectiveness | MISSING EVIDENCE | Needs production testing |
| Severity accuracy | MISSING EVIDENCE | Needs production validation |

### Evidence Gaps

| Gap | Impact | Classification |
|---|---|---|
| Warning→P6-06 integration | P6-06 scope | DEFERRED |
| Warning→P6-07 UI | P6-07 scope | DEFERRED |
| Production warning volume | Affects threshold tuning | NON-BLOCKING |
| Warning noise rate | Affects cooldown tuning | NON-BLOCKING |
| Cooldown effectiveness | Affects dedup behavior | NON-BLOCKING |
| Severity accuracy | Affects severity rules | NON-BLOCKING |

## 22. Dependency Matrix

### Upstream Dependencies

| Dependency | Layer | Required? | Status |
|---|---|---|---|
| P6-01 observations | Observation/Quality | YES | FROZEN |
| P6-02 features | Derived Features | YES | FROZEN |
| P6-03 snapshots | Intelligence Snapshot | YES | FROZEN |
| P6-04 regimes | Trend/Regime | YES | FROZEN |

### Downstream Consumers

| Consumer | Layer | Consumes What? |
|---|---|---|
| P6-06 | Intelligence Aggregation | Warnings + Regimes + Snapshots |
| P6-07 | UI/Dashboard | Warnings (via P6-06) |
| P6-08 | Historical/Backfill | Warning history |
| P4 | Decision Support | Does NOT consume P6-05 |
| P5 | Action/Policy | Does NOT consume P6-05 |

### No Modification Required

| Layer | Status |
|---|---|
| P6-01 | FROZEN — no modification |
| P6-02 | FROZEN — no modification |
| P6-03 | FROZEN — no modification |
| P6-04 | FROZEN — no modification |
| P4 | FROZEN — no modification |
| P5 | FROZEN — no modification |

## 23. Implementation Readiness

| Criterion | Status |
|---|---|
| P6-01 frozen | ✅ |
| P6-02 frozen | ✅ |
| P6-03 frozen | ✅ |
| P6-04 frozen | ✅ |
| P6-05 scope defined | ✅ |
| P6-05 inputs identified | ✅ |
| P6-05 outputs identified | ✅ |
| Warning domain model defined | ✅ |
| Warning vocabulary proposed | ✅ |
| Severity model proposed | ✅ |
| Material change semantics proposed | ✅ |
| Dedup semantics proposed | ✅ |
| Lifecycle proposed | ✅ |
| Provenance proposed | ✅ |
| Versioning proposed | ✅ |
| Determinism defined | ✅ |
| Coin/narrative defined | ✅ |
| Persistence boundary defined | ✅ |
| P4/P5 boundary defined | ✅ |
| Invariants defined (24) | ✅ |
| Decisions identified (14) | ✅ |
| Evidence gaps identified (6) | ✅ |
| Blocking decisions | 4 (PD-05B-01,02,03,04) |
| Non-blocking decisions | 10 |

**P6-05 is READY for P6-05C (Decision Inventory & Gap Audit).**

## 24. Open Questions

| Question | Impact | Deferral |
|---|---|---|
| Should stale data suppress warnings? | V1: no suppression | V2 decision |
| Should quality metadata affect severity? | V1: no effect | V2 decision |
| How should narrative warnings relate to coin warnings? | V1: independent | P6-06 scope |
| What is the optimal cooldown duration? | V1: 24 hours | Production tuning |
| Should warnings be acked by users? | V1: no ack workflow | V2 feature |
| How should warning volume be managed? | V1: basic dedup | Production tuning |

## 25. Conclusion

P6-05B defines the Early Warning semantic contract with:
- Complete warning domain model
- 7 proposed warning types
- 5 proposed severity levels
- Material change detection semantics
- Quality/freshness metadata preservation
- Deduplication with cooldown
- 5-state lifecycle
- Full provenance chain
- Standalone versioning
- Deterministic computation
- Coin/narrative symmetry
- 24 invariants
- 14 Planner decisions (0 frozen, 4 blocking, 10 non-blocking)
- 6 evidence gaps (all non-blocking)

All decisions remain PROPOSED. Planner acceptance is required before implementation.

This contract is the foundation for P6-05C (Decision Inventory), P6-05D (Planner Decision Contract), P6-05E (Implementation), P6-05F (Hardening/Freeze Audit), and P6-05-FINAL (Freeze Declaration).
