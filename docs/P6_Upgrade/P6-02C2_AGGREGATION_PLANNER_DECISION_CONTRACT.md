# P6-02C2 — Aggregation Planner Decision Contract

**Date:** 2026-08-26
**Task Type:** PLANNER DECISION CONTRACT — proposed resolutions awaiting Planner acceptance
**Baseline:** P6-02C1 (`2bb8e44`)
**Git boundary:** ONLY this document. No production code. No schema. No P3/P4/P5 changes.

---

## 1. Purpose

This document converts the P6-02C1 decision inventory into a formal Planner Decision Contract. It provides exact formulas, storage semantics, pipeline boundaries, and confidence calculations for each blocking decision, plus recorded defaults for non-blocking decisions.

**Critical distinction:** This document contains PROPOSED resolutions. The Agent does NOT freeze decisions. Planner acceptance is required before any resolution becomes FROZEN.

---

## 2. Decision Status Summary

| ID | Decision | Status | Classification |
|---|---|---|---|
| PD-4 | Version tuple storage | **PROPOSED** | BLOCKING |
| PD-7 | Pipeline strategy | **PROPOSED** | BLOCKING |
| PD-1/PD-C4 | Confidence formula | **PROPOSED** | BLOCKING |
| PD-5 | Health dimension weights | **PROPOSED** (default) | NON-BLOCKING |
| PD-2/PD-C1 | Minimum data threshold | **PROPOSED** (default) | NON-BLOCKING |
| PD-3/PD-6/PD-C5 | STALE weight multiplier | **PROPOSED** (default) | NON-BLOCKING |
| PD-6b | Multi-source priority | **PROPOSED** (default) | NON-BLOCKING |
| PD-C3 | Narrative health method | **PROPOSED** (default) | NON-BLOCKING |
| PD-C6 | Min dimension count | **PROPOSED** (default) | NON-BLOCKING |

---

## 3. PD-4 — Version Tuple Storage

### 3.1 Decision

**PROPOSED: Option B — New `p6_feature_versions` table**

### 3.2 Version Record Schema

```
p6_feature_versions
├── id                    SERIAL PRIMARY KEY
├── algorithm_version     VARCHAR(20) NOT NULL  -- e.g., "1.0.0"
├── parameter_version     VARCHAR(20) NOT NULL  -- e.g., "1.0.0"
├── schema_version        VARCHAR(20) NOT NULL  -- e.g., "1.0.0"
├── config_hash           VARCHAR(64) NOT NULL  -- SHA-256 of full config
├── description           TEXT                  -- human-readable
├── is_active             BOOLEAN DEFAULT TRUE
├── created_at            TIMESTAMP DEFAULT NOW()
├── activated_at          TIMESTAMP
└── UNIQUE(algorithm_version, parameter_version, schema_version, config_hash)
```

### 3.3 Version Identity

The version identity is the 4-tuple:

```
(algorithm_version, parameter_version, schema_version, config_hash)
```

**This is NOT the same as feature identity:**

| Concept | Identity Tuple | Purpose |
|---|---|---|
| Feature | `(entity_id, feature_name, timeframe, calc_window, algorithm_version, calculated_at)` | Which feature was computed |
| Version | `(algorithm_version, parameter_version, schema_version, config_hash)` | Which algorithm/config produced it |

The feature identity INCLUDES `algorithm_version` as a component. The version record is metadata ABOUT the algorithm, not the feature.

### 3.4 Relationship to Existing Versioning

| Existing Table | P6 Relationship | Boundary |
|---|---|---|
| `feature_versions` | Continues to serve P4/P5. `features.versionId` FK unchanged. | P4/P5 read `features.versionId` → `feature_versions` |
| `p6_feature_versions` | P6-only. `features.p6_version_id` FK (additive, nullable). | P6 reads `features.p6_version_id` → `p6_feature_versions` |
| `rule_versions` | Separate concern (P5). Not part of feature versioning. | Untouched |

### 3.5 Migration Strategy

1. Create `p6_feature_versions` table
2. Add nullable `p6_version_id` INTEGER FK to `features` table
3. Seed initial V1 version record: `("1.0.0", "1.0.0", "1.0.0", <hash of default config>)`
4. Backfill `p6_version_id` for existing feature rows (set to V1 seed)
5. Existing `features.versionId` column unchanged

### 3.6 Invariants

| ID | Invariant | Violation |
|---|---|---|
| PD4-01 | `p6_feature_versions` is P6-only; `feature_versions` continues to serve P4/P5 | CLASS-A |
| PD4-02 | Version identity `(algorithm_version, parameter_version, schema_version, config_hash)` must be unique | CLASS-A |
| PD4-03 | `features.versionId` (P4/P5) and `features.p6_version_id` (P6) are independent FKs | CLASS-B |
| PD4-04 | Config hash must be deterministic (same config → same hash) | CLASS-A |

---

## 4. PD-7 — Pipeline Strategy

### 4.1 Decision

**PROPOSED: Option B — Build new P6-native engine alongside legacy**

### 4.2 Pipeline Boundary

```
┌─────────────────────────────────────────────────────┐
│  LEGACY PIPELINE (P4/P5)                           │
│  Reads: market_price_daily, coin_metrics           │
│  Engine: src/lib/features/engine.ts                │
│  Output: features, health_scores, recommendations  │
│  Consumers: /api/coins, /api/dashboard, P4, P5     │
│  STATUS: UNTOUCHED — continues to serve P4/P5      │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  P6 PIPELINE (NEW)                                  │
│  Reads: canonical P6 observations                   │
│  Engine: src/lib/p6/feature/ (new module)           │
│  Output: features (with p6_version_id),            │
│          health_scores (with p6 provenance)         │
│  Consumers: P4/P5 (same tables, same columns)      │
│  STATUS: NEW — built in P6-02D                      │
└─────────────────────────────────────────────────────┘
```

### 4.3 Module Structure

```
src/lib/p6/feature/
├── engine.ts              -- P6 feature engine orchestrator
├── trend.ts               -- P6 trend calculation (reads P6 observations)
├── volume.ts              -- P6 volume calculation
├── momentum.ts            -- P6 momentum calculation
├── derivative.ts          -- P6 derivative calculation
├── confidence.ts          -- P6 confidence (quality-aware)
├── health.ts              -- P6 health aggregation
├── provenance.ts          -- Provenance assembly
├── types.ts               -- P6 feature types
└── __tests__/             -- Test suite
```

### 4.4 Output Compatibility

The P6 engine MUST produce output compatible with existing P4/P5 consumers:

| Output Field | Legacy Source | P6 Source | P4/P5 Consumer |
|---|---|---|---|
| `features.trend_score` | `runFeatureEngine().trend_score` | P6 engine TREND score | `/api/coins/[id]`, P4 explanation |
| `features.volume_score` | `runFeatureEngine().volume_score` | P6 engine VOLUME score | Same |
| `features.momentum_score` | `runFeatureEngine().momentum_score` | P6 engine MOMENTUM score | Same |
| `features.derivative_score` | `runFeatureEngine().derivative_score` | P6 engine DERIVATIVE score | Same |
| `features.confidence_score` | `calculateConfidence().confidence_score` | P6 engine CONFIDENCE score | P5 rule engine |
| `features.data_completeness` | `calculateConfidence().data_completeness` | P6 engine data_completeness | API consumers |
| `health_scores.health_score` | `calculateHealthScore()` | P6 engine HEALTH score | `/api/dashboard`, P4 interpretation |

### 4.5 Coexistence Strategy

1. **Phase 1 (P6-02D):** P6 engine writes to same `features`/`health_scores` tables with P6 provenance
2. **Phase 2 (switchover):** Legacy engine disabled; P6 engine becomes sole writer
3. **Phase 3 (cleanup):** Legacy engine code removed; `features.versionId` column deprecated

**P6-02D implements Phase 1 only.** Phase 2/3 are future tasks.

### 4.6 Invariants

| ID | Invariant | Violation |
|---|---|---|
| PD7-01 | Legacy engine MUST NOT be modified by P6-02D | CLASS-A |
| PD7-02 | P6 engine output MUST be column-compatible with legacy output | CLASS-A |
| PD7-03 | P4/P5 consumers MUST NOT need modification to read P6 output | CLASS-A |
| PD7-04 | Both engines MAY write to same tables during coexistence | CLASS-B |

---

## 5. PD-1 / PD-C4 — Confidence Formula

### 5.1 Decision

**PROPOSED: Option B — Quality-adjusted confidence**

### 5.2 Exact Formula

```
For each source s in {BINANCE_SPOT, BINANCE_FUTURES, COINGECKO}:

  total_observations_s = count of observations expected from source s
  valid_observations_s = count of VALID observations from source s
  quality_ratio_s = valid_observations_s / total_observations_s
                    (0 if total_observations_s = 0)

  source_available_s = 1 if source s responded, 0 otherwise
  source_indicator_s = source_available_s × quality_ratio_s

  source_weight_s = from rule_versions.confidence_weights

confidence_score = Σ(source_weight_s × source_indicator_s) / Σ(source_weight_s for available sources)
```

### 5.3 Denominator = 0 Behavior

When NO sources are available (all `source_available_s = 0`):

```
confidence_score = 0
data_completeness = 0
missing_sources = ["binance_spot", "binance_futures", "coingecko"]
```

This is the existing behavior for missing data and is preserved.

### 5.4 Backward Compatibility

| Scenario | Legacy Output | P6 Output | Compatible? |
|---|---|---|---|
| All sources available, all VALID | `100.0` | `100.0` | ✅ YES |
| All sources available, some INVALID | `100.0` (legacy ignores quality) | `< 100.0` (quality-adjusted) | ⚠️ VALUE DRIFT |
| Spot available, futures unavailable | `70.0` (weight redistribution) | `70.0` (same) | ✅ YES |
| All unavailable | `0.0` | `0.0` | ✅ YES |

**Value drift note:** When quality data is available, P6 confidence may differ from legacy confidence because quality_ratio < 1.0. This is the INTENDED improvement. P4/P5 consumers that use confidence for threshold comparisons (e.g., `confidence >= 50`) may see different results.

**Mitigation:** P4/P5 threshold values may need adjustment during switchover (Phase 2). This is a future concern, not a P6-02D blocker.

### 5.5 Rounding

```
confidence_score = round(confidence_score_raw, 1)  -- 1 decimal place
```

Clamped to `[0, 100]`.

### 5.6 Determinism

The formula is deterministic given:
- Same source availability flags
- Same quality states per observation
- Same source weights

Ordering: sources processed in fixed order `{BINANCE_SPOT, BINANCE_FUTURES, COINGECKO}`.

### 5.7 Freshness Interaction

Freshness states are NOT used in the confidence formula. Confidence measures data quality (quality_status), not data recency (freshness_status). This is consistent with P6-02B §5.4 and P6-02C §14.1.

### 5.8 UNKNOWN Quality Handling

When `quality_status = UNKNOWN` for observations:

- UNKNOWN observations are NOT counted as VALID in `valid_observations_s`
- UNKNOWN observations ARE counted in `total_observations_s`
- This reduces `quality_ratio_s` when quality was not evaluated

**Rationale:** UNKNOWN means quality was not determined. Including UNKNOWN as VALID would overstate confidence. Excluding UNKNOWN from total would understate it. Counting UNKNOWN in total but not valid is the conservative, correct behavior.

### 5.9 INVALID Handling

When `quality_status = INVALID`:

- INVALID observations are NOT counted as VALID
- INVALID observations ARE counted in `total_observations_s`
- This reduces `quality_ratio_s` proportionally

### 5.10 MISSING Handling

When `quality_status = MISSING`:

- MISSING observations are NOT counted as VALID
- MISSING observations ARE counted in `total_observations_s`
- This reduces `quality_ratio_s` proportionally

### 5.11 Invariants

| ID | Invariant | Violation |
|---|---|---|
| PD1-01 | Confidence formula MUST be deterministic given same inputs | CLASS-A |
| PD1-02 | Confidence MUST incorporate quality_status (not just source availability) | CLASS-A |
| PD1-03 | UNKNOWN quality MUST NOT be counted as VALID | CLASS-A |
| PD1-04 | Denominator = 0 MUST return 0 (not NaN, not error) | CLASS-A |
| PD1-05 | Confidence MUST remain in [0, 100] range | CLASS-A |
| PD1-06 | Freshness MUST NOT affect confidence calculation | CLASS-B |

---

## 6. Non-Blocking Defaults (Recorded, Not Frozen)

These are PROPOSED defaults. The Planner may override at any time.

### 6.1 PD-5 — Health Dimension Weights

**Default: Equal weights (25% each)**

```
health_score = (trend_score × 0.25 + momentum_score × 0.25 + volume_score × 0.25 + derivative_score × 0.25)
```

When a dimension is unavailable, its weight is redistributed equally to available dimensions.

**Override window:** P6-02D implementation or later.

### 6.2 PD-2 / PD-C1 — Minimum Data Threshold

**Default: No threshold**

Feature is always computed from available data. `data_completeness` reflects proportion of valid inputs. No minimum quality ratio enforced.

**Override window:** P6-02D implementation.

### 6.3 PD-3 / PD-6 / PD-C5 — STALE Weight Multiplier

**Default: No weighting V1 (all observations weighted equally)**

Freshness states are recorded in provenance but do not affect feature calculation weights in V1.

**Override window:** P6-02E or later.

### 6.4 PD-6b — Multi-Source Priority

**Default: No priority V1**

When multiple sources provide the same metric (e.g., BINANCE_SPOT and BINANCE_FUTURES both provide CLOSE), all observations contribute independently. No deduplication or priority selection.

**Override window:** P6-02E or later.

### 6.5 PD-C3 — Narrative Health Method

**Default: Market-cap weighted (current behavior)**

Preserves `calculateWeightedNarrativeHealth()` logic from `src/lib/scoring/narrative-health.ts`.

**Override window:** P6-02E.

### 6.6 PD-C6 — Minimum Dimension Count

**Default: No minimum**

HEALTH is computed from whatever dimensions are available. 1 of 4 dimensions is sufficient.

**Override window:** P6-02D implementation.

---

## 7. Dependency Resolution

```
PD-4 (version storage) ──→ RESOLVES: where version metadata lives
    └── enables P6-02D schema design

PD-7 (pipeline strategy) ──→ RESOLVES: where P6 engine lives
    └── enables P6-02D module architecture
    └── enables PD-1/PD-C4 (confidence formula location)

PD-1/PD-C4 (confidence) ──→ RESOLVES: exact confidence semantics
    └── enables P6-02D confidence implementation
    └── depends on PD-7 (must know engine location)
```

### Critical Path for P6-02D

```
PD-4 ──→ P6-02D schema ──→ P6-02D persistence
PD-7 ──→ P6-02D modules ──→ PD-1 ──→ P6-02D confidence
```

Both PD-4 and PD-7 can be resolved in parallel. PD-1 depends on PD-7.

---

## 8. Remaining Open Items

### For P6-02D (can use defaults):

| Item | Default | Notes |
|---|---|---|
| PD-5 health weights | Equal (25%) | Configurable per version |
| PD-2/PD-C1 threshold | No threshold | Preserve existing behavior |
| PD-3/PD-6/PD-C5 STALE weight | 1.0 (no weighting) | Freshness not consumed in V1 |
| PD-6b source priority | None | All sources contribute independently |
| PD-C6 min dimension count | None | 1 dimension sufficient |

### For P6-02E or later:

| Item | Default | Notes |
|---|---|---|
| PD-C3 narrative health | Market-cap weighted | Current behavior preserved |
| STALE weight refinement | Deferred | Can be added post-V1 |
| Source priority refinement | Deferred | Can be added post-V1 |

---

## 9. Implementation Readiness Gate

P6-02D MAY begin when ALL of the following are true:

| # | Gate | Status |
|---|---|---|
| 1 | PD-4 resolved by Planner | ⏳ PENDING |
| 2 | PD-7 resolved by Planner | ⏳ PENDING |
| 3 | PD-1/PD-C4 resolved by Planner | ⏳ PENDING |
| 4 | P6-02B contract frozen | ✅ DONE |
| 5 | P6-02C contract frozen | ✅ DONE |
| 6 | P6-01B/C/D/E contracts intact | ✅ DONE |
| 7 | Regression green (678 tests) | ✅ DONE |

**Current status: BLOCKED on gates 1-3.**

---

## 10. Invariants (Aggregate)

| ID | Invariant | Source | Violation |
|---|---|---|---|
| PD4-01 | `p6_feature_versions` is P6-only | PD-4 | CLASS-A |
| PD4-02 | Version tuple must be unique | PD-4 | CLASS-A |
| PD4-03 | Legacy `versionId` and P6 `p6_version_id` are independent | PD-4 | CLASS-B |
| PD4-04 | Config hash must be deterministic | PD-4 | CLASS-A |
| PD7-01 | Legacy engine MUST NOT be modified | PD-7 | CLASS-A |
| PD7-02 | P6 output MUST be column-compatible with legacy | PD-7 | CLASS-A |
| PD7-03 | P4/P5 consumers MUST NOT need modification | PD-7 | CLASS-A |
| PD7-04 | Both engines MAY coexist during transition | PD-7 | CLASS-B |
| PD1-01 | Confidence MUST be deterministic | PD-1 | CLASS-A |
| PD1-02 | Confidence MUST incorporate quality_status | PD-1 | CLASS-A |
| PD1-03 | UNKNOWN quality MUST NOT count as VALID | PD-1 | CLASS-A |
| PD1-04 | Denominator=0 MUST return 0 | PD-1 | CLASS-A |
| PD1-05 | Confidence MUST remain in [0, 100] | PD-1 | CLASS-A |
| PD1-06 | Freshness MUST NOT affect confidence | PD-1 | CLASS-B |

---

## 11. Planner Acceptance Checklist

| # | Item | Acceptance |
|---|---|---|
| 1 | PD-4: New `p6_feature_versions` table APPROVED | [ ] |
| 2 | PD-4: Schema definition APPROVED | [ ] |
| 3 | PD-4: Migration strategy APPROVED | [ ] |
| 4 | PD-7: Build new alongside APPROVED | [ ] |
| 5 | PD-7: Module structure APPROVED | [ ] |
| 6 | PD-7: Coexistence strategy APPROVED | [ ] |
| 7 | PD-1/PD-C4: Quality-adjusted formula APPROVED | [ ] |
| 8 | PD-1/PD-C4: UNKNOWN handling APPROVED | [ ] |
| 9 | PD-1/PD-C4: Rounding (1 decimal) APPROVED | [ ] |
| 10 | PD-5: Equal weights default ACCEPTED | [ ] |
| 11 | PD-2/PD-C1: No threshold default ACCEPTED | [ ] |
| 12 | PD-3/PD-6/PD-C5: No weighting default ACCEPTED | [ ] |
| 13 | PD-6b: No priority default ACCEPTED | [ ] |
| 14 | PD-C3: Market-cap weighted default ACCEPTED | [ ] |
| 15 | PD-C6: No minimum default ACCEPTED | [ ] |

---

## 12. Acceptance Checklist

- [x] Decision status summary complete
- [x] PD-4: version record schema, identity, relationship, migration strategy defined
- [x] PD-7: pipeline boundary, module structure, output compatibility, coexistence defined
- [x] PD-1/PD-C4: exact formula, denominator=0, rounding, determinism, UNKNOWN/INVALID/MISSING handling defined
- [x] Non-blocking defaults recorded
- [x] Dependency resolution documented
- [x] Remaining open items listed
- [x] Implementation readiness gate defined (7 items)
- [x] Invariants defined (14 invariants)
- [x] Planner acceptance checklist provided (15 items)
- [x] No production code modified
- [x] No schema/migration changes
- [x] No P6-01 contract modifications
- [x] No P3/P4/P5 modifications
- [x] No decisions frozen by agent
