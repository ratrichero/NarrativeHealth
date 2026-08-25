# P6-03B — Intelligence Snapshot Semantic Contract

**Date:** 2026-08-26
**Task Type:** CONTRACT DESIGN DOCUMENT ONLY — NO IMPLEMENTATION, NO SCHEMA, NO MIGRATION, NO API
**Baseline:** P6-03A Intelligence/Snapshot Landscape Recon (`ea2669a`)
**Frozen Authorities:** P6-01B/C/D/E (frozen), P6-02B/C/C1/C2 (frozen), P6-02D/E/F (implementation + audit)
**Git boundary:** ONLY this document. No production code. No schema. No P4/P5 changes. No P6-01/02 contract changes.

---

## 1. Purpose

This document defines the semantic contract for the P6 Intelligence Snapshot layer — the mechanism that captures a deterministic, reproducible point-in-time record of coin and narrative intelligence, tracing its full provenance back through derived features to canonical observations.

The contract specifies:

- Snapshot purpose and boundary
- Snapshot identity (independent of observation and feature identity)
- Input contract (consuming P6-derived outputs)
- Quality semantics (preserved as metadata)
- Freshness semantics (independent dimension)
- Provenance chain (observation → feature → snapshot)
- Versioning (structured version tuple propagation)
- Determinism and reproducibility requirements
- Snapshot lifecycle
- Backward compatibility with P4/P5
- V1 scope
- Reproducibility/replay boundary
- Planner Decision inventory
- Invariants

**This is a contract design document.** It does not implement, migrate, or modify any production code.

---

## 2. Frozen Dependencies

| Document | Commit | What It Freezes | Relevance to P6-03B |
|---|---|---|---|
| P6-01B | ad5d7df | Canonical observation identity, QualityState, Timeframe | Input vocabulary for provenance trace |
| P6-01C | various | FreshnessState, source vocabulary | Freshness metadata in snapshot |
| P6-01D | frozen | D2 sole quality authority, QualityState frozen | Quality metadata preserved |
| P6-01E | 62b5ee2 | Production kline wiring | Data source for observations |
| P6-02B | 17b6beb | Derived Feature identity, input contract, quality gating, provenance, versioning, V1 vocabulary | Direct upstream: feature outputs consumed by snapshot |
| P6-02C | 2b536b6 | Aggregation contract: state propagation, deterministic aggregation | Feature → health/aggregate outputs consumed by snapshot |
| P6-02C2 | 4b7f6f3 | Planner Decision resolutions for PD-1/PD-4/PD-7 | Frozen decisions affecting snapshot version handling |
| P6-02D | 7bd69dc | P6-native feature engine implementation | Implementation of features consumed by snapshot |
| P6-02E | 8c04cab | Feature persistence (p6_version_id, p6_provenance, p6_quality_metadata) | Feature records consumed by snapshot |
| P6-02F | 295348f | Derived feature freeze audit: READY FOR PLANNER FREEZE | Confirms upstream is coherent |
| P6-03A | ea2669a | Intelligence/snapshot landscape recon: current state, gaps, candidate decisions | Direct upstream recon |
| P4-P5 HANDOFF | — | P4/P5 frozen contracts | Hard boundary: must not be modified |

**Critical rule:** This contract MUST NOT modify any frozen authority above. If a conflict is discovered, STOP and report change-control.

---

## 3. Terminology

| Term | Definition | Source |
|---|---|---|
| **Observation** | Canonical P6 measurement: `(entity_id, metric, source, observed_at, timeframe)` | P6-01B §3.2 |
| **Feature** | Derived output from observations: TREND, VOLUME, MOMENTUM, DERIVATIVE, HEALTH, CONFIDENCE | P6-02B §10.2 |
| **QualityState** | `VALID \| INVALID \| MISSING \| UNKNOWN` | P6-01B §9.1, P6-01D frozen |
| **FreshnessState** | `FRESH \| STALE \| UNKNOWN` | P6-01C §4.1 |
| **VersionTuple** | `(algorithm_version, parameter_version, schema_version, config_hash)` | P6-02B §8.1 |
| **Snapshot** | A deterministic point-in-time capture of intelligence state for an entity or narrative | This document |
| **SnapshotType** | The category of intelligence captured: `COIN_HEALTH`, `NARRATIVE_HEALTH` | This document |
| **Provenance** | The chain linking a snapshot to its inputs through features to observations | This document |
| **Replay** | P5-07 historical reconstruction from persisted artifacts (frozen) | P5-05 §11 |

---

## 4. Snapshot Purpose & Boundary

### 4.1 What a Snapshot IS

A P6 Intelligence Snapshot is:

- A **deterministic, point-in-time record** of the intelligence state for an entity (coin) or narrative
- A **provenance-complete artifact** that traces its inputs back through features to canonical observations
- A **version-tagged computation** that records which algorithm, parameters, and inputs produced it
- An **immutable record** — once persisted, it is never mutated; superseded snapshots remain readable

### 4.2 What a Snapshot IS NOT

A P6 Intelligence Snapshot is NOT:

- A **canonical observation** (P6-01B) — snapshots consume features, not raw observations
- A **feature** (P6-02B) — snapshots consume aggregated feature outputs
- A **decision** (P5) — snapshots do not produce BUY/SELL signals or action permissions
- A **policy evaluation** (P5) — snapshots do not evaluate safety or approval rules
- A **recommendation** — snapshots record intelligence state, not action suggestions
- A **quality evaluation** (P6-01D) — snapshots preserve quality metadata but do not evaluate quality

### 4.3 Layer Position

```
Canonical Observation (P6-01)
    ↓ quality evaluation (P6-01D)
Derived Feature / Score (P6-02)
    ↓ aggregation
INTELLIGENCE SNAPSHOT (P6-03) ← this contract
    ↓ (read by)
P4 Interpretation (frozen)
    ↓
P5 Decision (frozen)
```

**IS-01:** A snapshot MUST NOT bypass or replace any layer in the pipeline. It is a consumer of feature outputs, not a producer of observations or features.

### 4.4 No Decision/Policy Semantics

**IS-02:** A snapshot MUST NOT introduce:

- BUY/SELL semantics
- Execution permissions
- Action policies
- Risk management thresholds
- Position sizing
- Entry/exit levels
- Any P5 decision semantics

Snapshots record intelligence state; P4/P5 consume that state for interpretation and decision-making.

---

## 5. Snapshot Identity

### 5.1 Definition

A P6 Intelligence Snapshot has a deterministic identity independent of canonical observation identity and feature identity:

```
SnapshotIdentity = (
    entity_type,          // "coin" | "narrative"
    entity_id,            // coin id or narrative id
    snapshot_type,        // "COIN_HEALTH" | "NARRATIVE_HEALTH"
    calculation_time,     // UTC wall-clock of calculation
    algorithm_version,    // from VersionTuple
    parameter_version,    // from VersionTuple
    input_window_end      // end timestamp of input data window
)
```

### 5.2 Identity Fields

| Field | Type | Definition | Constraints |
|---|---|---|---|
| `entity_type` | enum | Level of intelligence | Must be `coin` or `narrative` |
| `entity_id` | number | ID of the coin or narrative | Must reference existing entity |
| `snapshot_type` | enum | Category of snapshot | Must be from V1 vocabulary (§12) |
| `calculation_time` | Date | UTC wall-clock of calculation | For provenance; not part of deterministic identity |
| `algorithm_version` | string | From VersionTuple | Identifies algorithm logic |
| `parameter_version` | string | From VersionTuple | Identifies parameter set |
| `input_window_end` | Date | End of input data window | Aligns with latest observation timestamp |

### 5.3 Relationship to Other Identities

| Property | Observation (P6-01B) | Feature (P6-02B) | Snapshot (P6-03B) |
|---|---|---|---|
| Identity includes `metric` | YES | NO | NO |
| Identity includes `source` | YES | NO | NO |
| Identity includes `observed_at` | YES | NO | NO |
| Identity includes `feature_name` | NO | YES | NO |
| Identity includes `snapshot_type` | NO | NO | YES |
| Identity includes `algorithm_version` | NO | YES | YES |
| Identity includes `parameter_version` | NO | NO | YES |
| Identity includes `input_window_end` | NO | NO | YES |

**IS-03:** A SnapshotIdentity MUST NOT be confused with a Canonical Observation identity or a Feature identity. They are semantically distinct tuples at different aggregation layers.

### 5.4 Why Not Date-Only Identity

The legacy snapshot uses `date` as its sole identity (P6-03A §4.1). This is insufficient for P6 because:

1. Two snapshots on the same date could use different algorithm versions → different results
2. Two snapshots could use different parameter sets → different results
3. Date-only identity cannot distinguish between a legacy snapshot and a P6 snapshot
4. No way to determine which inputs produced a historical snapshot

**IS-04:** The `input_window_end` field replaces the legacy `date`-only identity with a temporally precise reference that aligns with observation timestamps.

---

## 6. Input Contract

### 6.1 P6-Native Inputs Only

A snapshot MUST consume P6-derived outputs as its semantic source of truth.

**IS-05:** A snapshot MUST NOT read from legacy `market_price_daily`, `coin_metrics`, `indicators`, or `morning_snapshots` tables as semantic source-of-truth. P6-02 feature/health outputs are the authoritative input.

### 6.2 Coin Health Snapshot Inputs

```
CoinHealthSnapshotInput
├── entity_id              (coin id)
├── feature_record         (P6 feature output from features table)
│   ├── trend_score
│   ├── volume_score
│   ├── momentum_score
│   ├── derivative_score
│   ├── health_score
│   ├── confidence_score
│   ├── data_completeness
│   ├── p6_provenance      (feature-level provenance)
│   ├── p6_quality_metadata (feature-level quality summary)
│   └── p6_version_id      (feature version FK)
├── health_dimensions      (from feature health_dimensions)
├── quality_summary        (aggregated from p6_quality_metadata)
├── freshness_summary      (aggregated from p6_quality_metadata)
├── calculation_time       (UTC wall-clock)
└── version_tuple          (from feature version)
```

### 6.3 Narrative Health Snapshot Inputs

```
NarrativeHealthSnapshotInput
├── entity_id              (narrative id)
├── coin_snapshots[]       (array of CoinHealthSnapshot for member coins)
│   └── [each coin's snapshot output]
├── membership_info        (which coins belong to this narrative)
│   ├── member_ids[]       (current narrative membership)
│   └── membership_source  (how membership was determined)
├── aggregation_method     (how narrative health is derived from coin health)
├── calculation_time       (UTC wall-clock)
└── version_tuple          (from aggregation version)
```

### 6.4 No Legacy Table Consumption

| Legacy Table | Allowed as Snapshot Input? | Reason |
|---|---|---|
| `market_price_daily` | NO | P6-02 features are the semantic source-of-truth |
| `coin_metrics` | NO | P6-02 features are the semantic source-of-truth |
| `indicators` | NO | P6-02 feature engine computes from observations |
| `morning_snapshots` | NO | Legacy; P6 snapshots are independent |
| `features` (with P6 columns) | YES | P6-02 feature output |
| `health_scores` (with P6 columns) | YES | P6-02 health output |
| `p6_feature_versions` | YES | Version metadata |

---

## 7. Quality Semantics

### 7.1 Preservation, Not Reinterpretation

**IS-06:** Quality states (VALID/INVALID/MISSING/UNKNOWN) MUST be preserved as metadata in the snapshot. They MUST NOT be reinterpreted, converted into scores, or used to generate new quality states.

### 7.2 Quality as Snapshot Metadata

A snapshot records the quality landscape of its inputs:

```
SnapshotQualityMetadata
├── input_quality_summary
│   ├── total_features_evaluated
│   ├── features_with_valid_inputs      (at least one VALID observation)
│   ├── features_with_invalid_inputs    (at least one INVALID observation)
│   ├── features_fully_unknown          (all inputs UNKNOWN quality)
│   └── overall_data_completeness       (from feature confidence)
├── per_dimension_quality
│   └── [dimension_name → quality_summary from feature]
└── quality_state_at_calculation
    └── [ QualityState preserved verbatim, never transformed ]
```

### 7.3 Quality ≠ Score

**IS-07:** A snapshot MUST NOT use quality states to compute, adjust, or gate the snapshot score itself. Quality metadata is recorded alongside the score, not applied to it.

The quality of a snapshot's inputs affects:
- Which observations contributed to features (via P6-02 quality gating)
- The `data_completeness` and `confidence_score` values in the feature output
- The quality metadata recorded in the snapshot

The quality of a snapshot's inputs does NOT:
- Reduce the snapshot score
- Mark the snapshot as "low quality"
- Trigger a different snapshot computation path
- Create a new QualityState for the snapshot

### 7.4 No New Quality States

**IS-08:** The snapshot layer MUST NOT create new QualityState values. The four frozen states remain: `VALID | INVALID | MISSING | UNKNOWN`.

---

## 8. Freshness Semantics

### 8.1 Independence from Quality

**IS-09:** Freshness (FRESH/STALE/UNKNOWN) MUST be preserved as metadata in the snapshot. It MUST NOT be converted into quality states, scores, or decision signals.

### 8.2 Freshness as Metadata

```
SnapshotFreshnessMetadata
├── input_freshness_summary
│   ├── fresh_observations_count
│   ├── stale_observations_count
│   └── unknown_freshness_count
├── per_dimension_freshness
│   └── [dimension_name → freshness_summary from feature]
└── freshness_state_at_calculation
    └── [ FreshnessState preserved verbatim ]
```

### 8.3 STALE ≠ INVALID

**IS-10:** A STALE observation remains whatever quality state it had. STALE is a temporal attribute, not a quality judgment. The snapshot MUST NOT treat STALE as INVALID.

### 8.4 Freshness Weighting — DEFERRED

**PD-03B-01 (PLANNER DECISION REQUIRED):** Should freshness weighting affect snapshot computation?

- Option A: No freshness weighting in V1 (snapshots computed from all available features regardless of freshness)
- Option B: STALE features receive reduced weight in narrative aggregation
- Option C: STALE features flagged in snapshot metadata but not weighted

**Evidence:** P6-02B PD-3/PD-6 defaulted to no STALE weighting in V1. P6-02D implementation uses this default. Snapshot layer should follow same decision.

**Recommendation:** Option A — consistency with P6-02 V1 default.

---

## 9. Provenance

### 9.1 Provenance Chain Requirement

**IS-11:** Every snapshot MUST maintain a complete provenance chain:

```
Snapshot
  → [input feature records]
    → [input feature provenance]
      → [input observation identities]
        → [observation quality_status]
        → [observation freshness_status]
        → [observation source]
        → [observation observed_at]
```

### 9.2 Minimum Snapshot Provenance

Every persisted snapshot MUST contain:

```
SnapshotProvenance
├── calculation_time              (UTC wall-clock of snapshot calculation)
├── version_tuple                 (algorithm_version, parameter_version, schema_version, config_hash)
├── input_features[]              (references to feature records used)
│   ├── feature_id                (FK to features table)
│   ├── feature_name              (TREND, VOLUME, MOMENTUM, DERIVATIVE, HEALTH, CONFIDENCE)
│   ├── feature_score             (value at time of snapshot)
│   ├── feature_p6_version_id     (FK to p6_feature_versions)
│   └── feature_calculated_at     (when feature was computed)
├── input_observations_count      (total observations that fed the features)
├── data_completeness             (overall data completeness at feature level)
├── quality_summary               (from feature p6_quality_metadata)
├── freshness_summary             (from feature p6_quality_metadata)
├── input_window_start            (earliest observation timestamp used)
├── input_window_end              (latest observation timestamp used)
├── entity_snapshot_time          (when this entity's snapshot was captured)
└── calculation_duration_ms       (how long the calculation took)
```

### 9.3 Narrative Snapshot Additional Provenance

For narrative-level snapshots, additionally:

```
NarrativeSnapshotProvenance (extends SnapshotProvenance)
├── member_coin_snapshots[]       (references to coin snapshots used)
│   ├── snapshot_id               (FK to coin snapshot)
│   ├── coin_id                   (which coin)
│   ├── health_score              (value used in narrative aggregation)
│   └── weight                    (weight applied in narrative aggregation)
├── membership_snapshot_id        (FK to narrative_membership_snapshots if available)
├── member_count                  (number of coins in narrative)
├── aggregation_method            (how narrative health was derived)
└── weighting_method              (how individual coin scores were weighted)
```

### 9.4 Provenance Immutability

**IS-12:** Once a snapshot is persisted, its provenance is immutable. Recalculation produces a new snapshot with new `calculation_time` and potentially different provenance.

---

## 10. Versioning

### 10.1 Version Tuple Propagation

**IS-13:** Every snapshot MUST be traceable to a structured version tuple that propagates from feature calculation through snapshot generation.

```
Snapshot Version Tuple:
├── algorithm_version     (snapshot algorithm: "p6-snapshot-v1")
├── parameter_version     (snapshot parameters: "default-v1")
├── schema_version        (snapshot output schema: "v1")
└── config_hash           (hash of snapshot configuration)
```

### 10.2 Version Layering

| Layer | Version Source | Propagation |
|---|---|---|
| Feature calculation | `p6_feature_versions` (PD-4) | Feature → snapshot input_features |
| Snapshot generation | New snapshot version tuple | Snapshot → snapshot provenance |
| Narrative aggregation | Separate version tuple | Narrative snapshot → narrative provenance |

**IS-14:** The snapshot version tuple is SEPARATE from the feature version tuple. A snapshot records which feature version it consumed AND its own algorithm version.

### 10.3 Legacy Version Fields

| Legacy Field | P6 Relationship | Boundary |
|---|---|---|
| `feature_versions.version` (integer) | Continues to serve P4/P5 via `features.versionId` | Untouched |
| `p6_feature_versions` (4-tuple) | P6 feature versioning via `features.p6_version_id` | Read by snapshot |
| `rule_versions` | P5 rule versioning | Untouched |
| Snapshot version tuple | New P6-03 artifact | Additive |

---

## 11. Determinism & Reproducibility

### 11.1 Determinism Contract

**IS-15:** Given the same inputs, same feature versions, and same snapshot version, a snapshot calculation MUST produce identical output.

Determinism requirements:

| Aspect | Requirement |
|---|---|
| Input ordering | Features processed in deterministic order (by feature_name alphabetically) |
| Narrative member ordering | Coins processed in deterministic order (by coin_id ascending) |
| Rounding | Snapshot scores use same rounding as features (2 decimal places for scores, 1 for confidence) |
| Timestamps | `calculation_time` is wall-clock (NOT deterministic — for provenance only) |
| Version tuples | Same version tuple → same algorithm logic → same output |

### 11.2 Reproducibility Requirements

A snapshot MUST be reproducible from:

1. The input feature records (referenced by `feature_id` in provenance)
2. The snapshot algorithm version
3. The snapshot parameter version
4. The snapshot configuration (weights, thresholds)

**IS-16:** A snapshot MUST NOT depend on live database state, external API calls, or non-deterministic sources during calculation. All inputs must be read from persisted records.

### 11.3 Historical Snapshot Reconstruction

Given a persisted snapshot with complete provenance:

1. Read the referenced feature records from `features` table
2. Read the version tuples from `p6_feature_versions`
3. Apply the snapshot algorithm with recorded parameters
4. The reconstructed result MUST match the original snapshot (excluding `calculation_time`)

**IS-17:** Historical snapshot reconstruction is a verification mechanism, not a production path. The primary path is always fresh calculation from current features.

---

## 12. Snapshot Lifecycle

### 12.1 Lifecycle States

A snapshot progresses through semantic states:

```
GENERATED → PERSISTED → [SUPERSEDED | CURRENT]
```

| State | Definition |
|---|---|
| `GENERATED` | Calculation complete, not yet persisted |
| `PERSISTED` | Written to database, available for consumption |
| `CURRENT` | Latest snapshot for this entity/type at this time window |
| `SUPERSEDED` | A newer snapshot exists for this entity/type |

### 12.2 Latest-Only Semantics

**IS-18:** For each `(entity_type, entity_id, snapshot_type, input_window_end)`, only the LATEST snapshot is `CURRENT`. Previous snapshots are retained as `SUPERSEDED` but not deleted.

### 12.3 No Quality State for Snapshots

**IS-19:** The snapshot lifecycle states (GENERATED/PERSISTED/CURRENT/SUPERSEDED) are NOT quality states. They do NOT appear in the `QualityState` vocabulary (VALID/INVALID/MISSING/UNKNOWN). They are operational states for record management.

### 12.4 Unavailable Snapshots

If a snapshot cannot be generated (e.g., no feature data available):

- No snapshot record is persisted
- The absence is recorded in provenance metadata
- P4/P5 consumers handle missing snapshots gracefully (existing behavior)

---

## 13. Backward Compatibility

### 13.1 P4/P5 Consumer Protection

**IS-20:** P6-03 MUST NOT modify any P4 or P5 contract, implementation, or behavior.

| Protected Component | What It Reads | P6-03 Obligation |
|---|---|---|
| P4 interpretation engine | `features`, `health_scores` | Column values must remain compatible |
| P4 explanation engine | Feature detail JSONB | Shape must remain compatible |
| P5 rule engine | Score fields via `ScoreInput` | Score values must remain compatible |
| P5 policy/safety evaluator | P4 interpretation results | Must not be modified |
| P5 decision producer | P5 decision records | Must not be modified |
| P5 artifact recorder | Persisted artifacts | Must not be modified |
| P5 replay engine | Historical artifacts | Must not be modified |
| `/api/dashboard` | `health_scores`, `recommendations` | Must remain readable |
| `/api/coins/[id]` | `features`, `health_scores` | Must remain readable |
| `/api/narratives/[id]` | `features`, `health_scores`, `narrative_health` | Must remain readable |

### 13.2 Schema Additive-Only

**IS-21:** Existing table schemas MAY be extended with new columns but existing columns MUST NOT be removed, renamed, or have their semantic meaning changed.

### 13.3 Score Range Compatibility

All snapshot scores MUST remain in the 0–100 range. This is a contract with P4/P5 consumers.

### 13.4 Signal Compatibility

Recommendation signals MUST remain: `STRONG_WATCH`, `WATCH`, `OBSERVE`, `WEAK`. P6 snapshots do not produce signals; this is preserved.

### 13.5 P5 Historical Integrity

**IS-22:** P6-03 MUST NOT break P5-07 replay semantics:

- Historical artifacts always win over live state
- Replay is deterministic: same decisionId + same artifacts + same replayContractVersion → same report
- Replay ≠ re-execution: zero side effects
- P6 snapshots are new artifacts, not modifications to existing P5 artifact paths

### 13.6 P5 Replay Boundary

P6 snapshots are **new additions** to the intelligence pipeline. They do NOT replace, modify, or interfere with existing P5 artifact recording or replay. P5-07 continues to read from its existing artifact tables. P6 snapshot data is available as supplementary information but is NOT consumed by P5 replay.

---

## 14. V1 Scope

### 14.1 Snapshot Types in V1

| SnapshotType | Entity Level | Inputs | Status |
|---|---|---|---|
| `COIN_HEALTH` | Coin | P6 feature output (trend, volume, momentum, derivative, health, confidence) | IN SCOPE |
| `NARRATIVE_HEALTH` | Narrative | Array of COIN_HEALTH snapshots + membership info | IN SCOPE (if evidence sufficient) |

### 14.2 Narrative Health — Evidence Gap

**PD-03B-02 (PLANNER DECISION REQUIRED):** Is the narrative health aggregation method sufficiently specified for V1?

Current evidence:
- P6-02B PD-8 identified narrative health as P6-02/P6-03 scope
- P6-03A identified `calculateWeightedNarrativeHealth()` as existing implementation
- Market-cap weighting is the default (P6-02C2 §6.5 PD-C3)

Options:
- A: Include narrative health snapshot in V1 (market-cap weighted, reusing existing logic)
- B: Defer narrative health snapshot to V2 (coin-level only in V1)
- C: Include narrative health snapshot but mark as PROPOSED, not frozen

**Recommendation:** Option A — the existing implementation provides sufficient evidence for a V1 contract.

### 14.3 Metrics NOT in V1 Scope

The following are explicitly OUT of V1 scope:

- Cross-coin metrics (breadth, participation, relative_strength)
- Temporal stability metrics
- Correlation-based snapshots
- Intraday snapshots (4H timeframe snapshots)
- Any BUY/SELL or action-producing snapshots

---

## 15. Reproducibility / Replay Boundary

### 15.1 Three Distinct Concepts

| Concept | Definition | Who Owns |
|---|---|---|
| **Recomputation** | Fresh calculation from current feature data | P6-03 |
| **Historical Snapshot Read** | Reading a persisted snapshot from the database | P6-03 (read path) |
| **P5 Replay** | Reconstructing P5 decisions from historical artifacts | P5 (frozen) |

### 15.2 Recomputation vs Historical Read

- **Recomputation** reads current feature records and produces a new snapshot
- **Historical read** retrieves a previously persisted snapshot
- Both return the same data for the same inputs (determinism guarantee)

### 15.3 P5 Replay Separation

**IS-23:** P6-03 snapshots are NOT part of the P5 replay artifact chain. P5-07 replay reads from P5's own artifact tables. P6 snapshots are supplementary intelligence records, not P5 decision artifacts.

If P5 replay needs P6 intelligence data in the future, that would require a separate P5 contract modification (which is frozen and requires change-control).

---

## 16. Planner Decision Inventory

| ID | Question | Evidence | Options | Recommended | Dependency | Blocking | Evidence Gap |
|---|---|---|---|---|---|---|---|
| PD-03B-01 | Should freshness weighting affect snapshot computation? | P6-02B PD-3/PD-6 defaulted to no weighting in V1 | A: No weighting V1, B: STALE reduced weight, C: STALE flagged only | A (no weighting V1) | P6-02B PD-3/PD-6 | NON-BLOCKING | E-1 |
| PD-03B-02 | Include narrative health snapshot in V1? | P6-03A recon; existing `calculateWeightedNarrativeHealth()` | A: Include V1, B: Defer to V2, C: Include as PROPOSED | A (include V1) | P6-02B PD-8 | NON-BLOCKING | E-2 |
| PD-03B-03 | Snapshot granularity: per-refresh or per-day? | P6-03A: legacy uses daily; P6-01E refresh is per-trigger | A: Per-refresh (latest-only), B: Per-day (one per date), C: Both | A (per-refresh, latest-only) | None | NON-BLOCKING | E-3 |
| PD-03B-04 | Narrative aggregation method for V1? | P6-02C2 PD-C3 defaulted to market-cap weighted | A: Market-cap weighted (existing), B: Equal weight, C: Configurable | A (market-cap weighted) | PD-03B-02 | NON-BLOCKING | E-4 |
| PD-03B-05 | Should snapshot persist to new table or extend existing? | P6-03A: morning_snapshot_* tables exist | A: New p6_snapshots table, B: Extend morning_snapshot_* tables, C: Both | A (new table) — clean separation | None | NON-BLOCKING | E-5 |
| PD-03B-06 | Snapshot reconstruction scope: full or summary? | P6-03A G-4 | A: Full (all inputs recorded), B: Summary + hashes, C: Provenance-only | A (full provenance) — maximum traceability | None | NON-BLOCKING | — |
| PD-03B-07 | Coin snapshot identity: add timeframe to key? | P6-03B §5.1 identity definition | A: Include timeframe in identity, B: Single timeframe V1 | B (single timeframe V1) — DAILY only initially | None | NON-BLOCKING | E-6 |

### 16.1 Blocking vs Non-Blocking

| Blocking Decisions | Count |
|---|---|
| **BLOCKING** | **0** |
| **NON-BLOCKING** | **7** |

All 7 decisions have safe V1 defaults that can be used for implementation without Planner resolution. Planner decisions are required before the snapshot layer is declared FROZEN, but NOT before P6-03C implementation begins.

---

## 17. Invariants

| ID | Invariant | Rationale | Violation |
|---|---|---|---|
| **IS-01** | Snapshot MUST NOT bypass or replace any pipeline layer | Layer integrity | CLASS-A |
| **IS-02** | Snapshot MUST NOT introduce BUY/SELL or P5 decision semantics | P4/P5 boundary | CLASS-A |
| **IS-03** | SnapshotIdentity MUST NOT be confused with Observation or Feature identity | Identity layer separation | CLASS-A |
| **IS-04** | `input_window_end` replaces legacy `date`-only identity | Temporal precision | CLASS-B |
| **IS-05** | Snapshot MUST consume P6-derived outputs as semantic source-of-truth | Canonical observation consumption | CLASS-A |
| **IS-06** | Quality states preserved as metadata, not reinterpreted | P6-01D frozen vocabulary | CLASS-A |
| **IS-07** | Quality MUST NOT be used to compute or adjust snapshot scores | Quality ≠ score separation | CLASS-A |
| **IS-08** | Snapshot MUST NOT create new QualityState values | P6-01D frozen vocabulary | CLASS-A |
| **IS-09** | Freshness preserved as metadata, not converted to quality | P6-01C independence | CLASS-A |
| **IS-10** | STALE ≠ INVALID | Freshness/quality independence | CLASS-A |
| **IS-11** | Every snapshot MUST maintain complete provenance chain to observations | Traceability | CLASS-B |
| **IS-12** | Snapshot provenance is immutable once persisted | Record integrity | CLASS-B |
| **IS-13** | Every snapshot MUST be traceable to a structured version tuple | Reproducibility | CLASS-B |
| **IS-14** | Snapshot version tuple is SEPARATE from feature version tuple | Layer independence | CLASS-B |
| **IS-15** | Same inputs + same versions → same snapshot output | Determinism | CLASS-B |
| **IS-16** | Snapshot MUST NOT depend on live DB state during calculation | Reproducibility | CLASS-A |
| **IS-17** | Historical reconstruction from provenance MUST match original | Verification | CLASS-B |
| **IS-18** | Latest-only semantics per (entity_type, entity_id, snapshot_type, window_end) | Consistency | CLASS-B |
| **IS-19** | Lifecycle states are NOT quality states | Vocabulary separation | CLASS-A |
| **IS-20** | P6-03 MUST NOT modify P4/P5 contracts or implementations | P4/P5 boundary | CLASS-A |
| **IS-21** | Existing table schemas additive-only | Backward compatibility | CLASS-A |
| **IS-22** | P5-07 replay semantics MUST NOT be broken | Historical integrity | CLASS-A |
| **IS-23** | P6 snapshots are NOT P5 replay artifacts | Replay boundary | CLASS-A |

---

## 18. Evidence Gaps

| # | Gap | Why Needed | How to Resolve |
|---|---|---|---|
| E-1 | Whether STALE weighting is needed in V1 snapshots | PD-03B-01 resolution | Production observation of stale data impact |
| E-2 | Narrative membership count and distribution | Performance planning for narrative snapshots | Production DB query |
| E-3 | Production refresh frequency and snapshot volume | Storage and performance planning | Production monitoring |
| E-4 | Market-cap data availability for narrative weighting | PD-03B-04 implementation | Verify coin_metrics has market_cap for all coins |
| E-5 | morning_snapshot_headers row count and schema details | PD-03B-05 table design decision | Production DB inspection |
| E-6 | Whether multi-timeframe snapshots are needed | PD-03B-07 identity design | Product requirement clarification |

---

## 19. Non-Scope

This contract explicitly does NOT define:

- Snapshot implementation (P6-03C)
- Snapshot persistence schema (P6-03C)
- Snapshot API endpoints (P6-03D)
- Cross-coin intelligence (breadth, participation, relative_strength) — future P6
- Intraday snapshots (4H timeframe) — future P6
- BUY/SELL or action-producing snapshots — NEVER in P6
- P4/P5 contract modifications — FROZEN
- P5 artifact recording changes — FROZEN
- P5 replay engine changes — FROZEN
- Historical snapshot comparison mechanisms — future P6
- Snapshot UI components — separate task

---

## 20. Relationship to Frozen P6-01/02 Contracts

| Contract | P6-03B Relationship | Boundary |
|---|---|---|
| P6-01B Observation Identity | Snapshot provenance traces to observation identity; snapshot does NOT produce observations | STRICT — snapshot is downstream |
| P6-01C Source Vocabulary | Snapshot uses source identity for provenance only | STRICT — snapshot does NOT define sources |
| P6-01C Freshness | Snapshot preserves freshness as metadata (PD-03B-01 determines weighting) | OPTIONAL — V1 may ignore weighting |
| P6-01D Quality | Snapshot preserves quality as metadata; D2 remains sole quality authority | STRICT — snapshot does NOT evaluate quality |
| P6-02B Feature Identity | Snapshot consumes feature outputs; feature identity is distinct from snapshot identity | STRICT — layers are distinct |
| P6-02C Aggregation | Snapshot consumes aggregated feature/health outputs | STRICT — snapshot is downstream of aggregation |
| P6-02C2 Decisions | Snapshot respects frozen PD-1/PD-4/PD-7 resolutions | STRICT — no reinterpretation |
| P4-P5 HANDOFF | P4/P5 contracts are frozen; snapshot must produce compatible outputs | STRICT — no modification |

---

## 21. Acceptance Checklist

- [x] Snapshot purpose and boundary defined (§4)
- [x] Snapshot identity defined, independent from observation/feature identity (§5)
- [x] Input contract specifies P6-native consumption (§6)
- [x] Quality semantics preserve frozen vocabulary as metadata (§7)
- [x] Freshness semantics independent from quality (§8)
- [x] Provenance chain traces to observations (§9)
- [x] Versioning uses structured version tuple (§10)
- [x] Determinism and reproducibility requirements defined (§11)
- [x] Snapshot lifecycle defined (§12)
- [x] Backward compatibility with P4/P5 protected (§13)
- [x] V1 scope defined (§14)
- [x] Reproducibility/replay boundary defined (§15)
- [x] Planner Decision inventory complete (§16) — 7 decisions, 0 blocking
- [x] Invariants defined (§17) — 23 invariants
- [x] Evidence gaps documented (§18)
- [x] Non-scope explicitly defined (§19)
- [x] No production code modified
- [x] No schema/migration changes
- [x] No P6-01/02 contract modifications
- [x] No P3/P4/P5 modifications
- [x] No semantic decisions frozen by agent
