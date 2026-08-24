# P6-02B — Derived Feature Semantic Contract

**Date:** 2026-08-26
**Task Type:** CONTRACT DESIGN DOCUMENT ONLY — NO IMPLEMENTATION, NO SCHEMA, NO MIGRATION
**Baseline:** P6-02A Derived Feature Landscape Recon (`3ed1714`)
**Frozen Authorities:** P6-01B (ad5d7df), P6-01C (various), P6-01D (frozen), P6-01E (62b5ee2), P6-01-FINAL (8a1db6e)
**Git boundary:** ONLY this document. No production code. No schema. No P3/P4/P5 changes. No P6-01 contract changes.

---

## 1. Purpose

This document defines the semantic contract for the P6 Derived Feature layer — the bridge between P6 canonical observations and the intelligence/scoring pipeline consumed by P4/P5.

The contract specifies:

- Derived Feature identity semantics
- Input contract (Canonical Observation → Feature Input)
- Quality gating rules
- Freshness interaction model
- Provenance requirements
- Versioning model
- V1 feature vocabulary
- Health dimension decomposition
- Backward compatibility guarantees
- Planner Decision Inventory
- Derived Feature invariants

**This is a contract design document.** It does not implement, migrate, or modify any production code.

---

## 2. Frozen Dependencies

| Document | Commit | What It Freezes |
|---|---|---|
| P6-01B | ad5d7df | Canonical observation identity: `(entity_id, metric, source, observed_at, timeframe)`. QualityState: VALID/INVALID/MISSING/UNKNOWN. Timeframe: DAILY/4H/SOURCE_SNAPSHOT |
| P6-01C | various | Source vocabulary: BINANCE_SPOT/BINANCE_FUTURES/COINGECKO. FreshnessState: FRESH/STALE/UNKNOWN |
| P6-01D | frozen | D2 sole quality authority. D4 orchestration only. Quality persistence. OI-01…OI-08 unresolved |
| P6-01E | 62b5ee2 | Production kline wiring. PD-E1…PD-E4 frozen |
| P6-01-FINAL | 8a1db6e | Phase-level audit PASS. No contract violations |
| P6-02A | 3ed1714 | Feature landscape recon. Gap analysis. Candidate decisions CD-1…CD-6 |

**Critical rule:** This contract MUST NOT modify any frozen authority above. If a conflict is discovered, STOP and report change-control.

---

## 3. Derived Feature Identity

### 3.1 Definition

A Derived Feature has a deterministic identity:

```
FeatureIdentity = (entity_id, feature_name, timeframe, calc_window, algorithm_version, calculated_at)
```

Where:

| Field | Type | Definition | Constraints |
|---|---|---|---|
| `entity_id` | number | The coin/entity this feature was computed for | Must match P6-01B entity_id |
| `feature_name` | FeatureName | The computed feature | Must be from V1 vocabulary (§10) |
| `timeframe` | Timeframe | Temporal resolution of input observations | Must be from P6-01B frozen vocabulary: DAILY, 4H, SOURCE_SNAPSHOT |
| `calc_window` | string | Input window description | Deterministic representation of which observations were used (e.g., "200D", "50×4H") |
| `algorithm_version` | string | Structured version tuple | See §8 (Versioning) |
| `calculated_at` | Date | Wall-clock time of calculation | UTC; for reproducibility provenance only |

### 3.2 Relationship to Canonical Observation Identity

```
Canonical Observation Identity:
    (entity_id, metric, source, observed_at, timeframe)

Derived Feature Identity:
    (entity_id, feature_name, timeframe, calc_window, algorithm_version, calculated_at)
```

**Critical distinctions:**

| Property | Observation | Derived Feature |
|---|---|---|
| Identity key includes `metric` | YES | NO — feature_name replaces metric |
| Identity key includes `source` | YES | NO — feature aggregates across sources |
| Identity key includes `observed_at` | YES | NO — feature covers a window of observations |
| Identity key includes `algorithm_version` | NO | YES — recalculation changes identity |
| Identity key includes `calculated_at` | NO | YES — deterministic but unique per calculation |

**DF-01:** A Derived Feature identity MUST NOT be confused with a Canonical Observation identity. They are semantically distinct tuples.

### 3.3 Deterministic Recalculation

Two calculations with the same `(entity_id, feature_name, timeframe, calc_window, algorithm_version)` that observe the same canonical observation inputs MUST produce the same feature output.

`calculated_at` differs between runs (it is wall-clock), but the feature output is deterministic given identical inputs and algorithm version.

### 3.4 Immutability

Once persisted, a feature record is replaced (latest-only) by the next calculation with the same identity tuple (excluding `calculated_at`). Historical feature records are NOT retained in V1.

---

## 4. Input Contract

### 4.1 Canonical Observation → Feature Input

Derived Features MUST read from canonical P6 observations, NOT from legacy `market_price_daily` or `coin_metrics` tables as semantic source-of-truth.

**DF-02:** Every Derived Feature input MUST be traceable to a canonical observation identity `(entity_id, metric, source, observed_at, timeframe)`.

### 4.2 Input Selection

```
FeatureInputSelection
├── entity_id          (which coin)
├── feature_name       (which feature)
├── metrics[]          (which canonical metrics required)
├── sources[]          (which sources to read from)
├── timeframe          (which temporal resolution)
├── window_size        (how many observations to include)
└── quality_filter     (minimum quality for inclusion — see §5)
```

### 4.3 Minimum Required Inputs Per Feature

| Feature | Required Metrics | Required Sources | Min Observations | Notes |
|---|---|---|---|---|
| `TREND` | CLOSE | Any (BINANCE_SPOT, BINANCE_FUTURES) | 20 (EMA-20 minimum) | 200 recommended for EMA-200 |
| `VOLUME` | VOLUME | Any | 1 | 20 recommended for MA-20 |
| `MOMENTUM` | CLOSE, HIGH, LOW | Any | 15 (ROC-14 + 1) | For ROC-14 and ATR-14 |
| `DERIVATIVE` | OPEN_INTEREST, FUNDING_RATE | BINANCE_FUTURES | 0 or 2 | Current + previous OI for change; coin may have no futures |
| `HEALTH` | (aggregates TREND+DERIVATIVE+VOLUME+MOMENTUM) | — | Depends on sub-features | Composite only |
| `CONFIDENCE` | (quality metadata from all inputs) | All available | 0 | Quality-aware (see §5.4) |

### 4.4 Timeframe Alignment

Observations used as input to a feature MUST share the same `timeframe`. A feature computed from DAILY observations MUST NOT include 4H observations.

**Exception:** A feature MAY declare multiple timeframe inputs (e.g., daily trend + 4H momentum) only if:
- The feature_name explicitly supports multi-timeframe composition
- Each timeframe input is separately quality-gated
- The composition is documented in the algorithm version

### 4.5 Missing Input Handling

| Scenario | Feature Behavior |
|---|---|
| Fewer observations than minimum | Feature returns neutral default with `data_completeness < 100` (existing behavior preserved) |
| All required observations MISSING | Feature returns neutral default with `data_completeness = 0` |
| Single required metric MISSING (e.g., OPEN_INTEREST) | Feature degrades gracefully (existing derivative behavior preserved) |
| Source unavailable | Feature excludes that source's contribution (existing confidence behavior preserved) |

### 4.6 UNKNOWN observed_at

When input observations have `observed_at = UNKNOWN`:

- The observation is still usable for feature calculation (value is valid even if timestamp is unknown)
- The feature's `calc_window` descriptor may note "partial temporal coverage"
- UNKNOWN observed_at does NOT prevent feature calculation
- UNKNOWN observed_at DOES prevent freshness evaluation (P6-01C: UNKNOWN observed_at → freshness UNKNOWN)

### 4.7 Multi-Source Input

When a feature reads from multiple sources (e.g., BINANCE_SPOT + BINANCE_FUTURES for CLOSE):

- Each source provides observations independently
- Source identity is preserved in provenance (§7)
- Missing source reduces `data_completeness` but does not block calculation
- Source priority is NOT part of this contract (PLANNER DECISION REQUIRED — see PD-5)

---

## 5. Quality Gating

### 5.1 Core Principle

**DF-03:** Quality gating controls which observations are included in feature calculation. It MUST NOT create new QualityState values.

The four frozen QualityStates remain exactly:

```
VALID | INVALID | MISSING | UNKNOWN
```

### 5.2 Quality Gate Rules

| Input QualityState | Feature Inclusion | Effect on Feature |
|---|---|---|
| `VALID` | INCLUDED | Full weight in calculation |
| `INVALID` | EXCLUDED | Observation not used; reduces data_completeness |
| `MISSING` | EXCLUDED | Observation not used; reduces data_completeness |
| `UNKNOWN` | INCLUDED | Full weight (quality cannot be determined; observation is usable) |

**Rationale for UNKNOWN inclusion:** UNKNOWN means quality was not evaluated (e.g., missing freshness policy). Excluding UNKNOWN observations would silently discard usable data. The planner may revisit this in a future decision.

### 5.3 INVALID ≠ Automatic Exclusion from ALL Features

An observation marked INVALID for one metric does NOT imply INVALID for related metrics. For example, if `OHLC_HIGH_GE_LOW` fails, only the OHLC group is INVALID — `VOLUME` from the same observation may still be VALID.

Each metric's quality status gates only that metric's inclusion.

### 5.4 Confidence Integration

The confidence calculation MUST incorporate quality metadata:

```
ConfidenceInput
├── source_availability[]     (which sources responded — existing)
├── quality_states[]          (per-metric quality states — new)
└── freshness_states[]        (per-observation freshness — new, see §6)
```

The confidence score must reflect:
- Source availability (existing behavior)
- Proportion of VALID vs non-VALID inputs
- Proportion of FRESH vs non-FRESH inputs

**PD-1 (PLANNER DECISION REQUIRED):** Exact weighting formula for quality-aware confidence. Options:
- A: Binary (any INVALID → confidence penalty)
- B: Proportional (confidence = (VALID count / total count) × source_confidence)
- C: Weighted per metric (each metric has independent quality contribution)

### 5.5 Mixed-Quality Inputs

When a feature receives inputs with mixed quality states (some VALID, some INVALID):

- Only VALID and UNKNOWN observations are included
- `data_completeness` reflects the proportion of VALID+UNKNOWN vs total expected
- Feature output is computed from the available valid subset
- No interpolation or auto-correction of INVALID values

**PD-2 (PLANNER DECISION REQUIRED):** Threshold for degraded feature output. Options:
- A: No threshold — always compute from available data
- B: Minimum data threshold — return neutral default if < N observations are VALID
- C: Per-feature configurable minimum

---

## 6. Freshness Interaction

### 6.1 Core Principle

**DF-04:** Freshness provides weighting context for feature calculation. It MUST NOT be converted into quality states. Quality and freshness are independent dimensions (P6-01B §10, P6-01C §4.2).

### 6.2 Freshness as Weighting Signal

| FreshnessState | Feature Weight Multiplier | Rationale |
|---|---|---|
| `FRESH` | 1.0 (full weight) | Data is current |
| `STALE` | PD-3 (PLANNER DECISION) | Data may not reflect current state |
| `UNKNOWN` | 1.0 (full weight) | Cannot determine staleness; treat as usable |

**PD-3 (PLANNER DECISION REQUIRED):** STALE weight multiplier. Options:
- A: Binary (STALE = 0.5)
- B: Linear decay (based on age / stale_after ratio)
- C: Per-feature configurable
- D: No weighting (ignore freshness in V1)

### 6.3 Freshness Does NOT Affect Quality

A STALE observation that is VALID remains VALID. A FRESH observation that is INVALID remains INVALID. Freshness and quality are orthogonal dimensions.

### 6.4 Freshness Does NOT Affect Feature Existence

A feature is computed if sufficient valid inputs exist, regardless of freshness. Freshness affects weighting, not whether the feature is produced.

---

## 7. Provenance

### 7.1 Minimum Provenance Contract

Every persisted Derived Feature record MUST contain:

```
FeatureProvenance
├── input_observations[]       (list of canonical observation identities used)
│   ├── entity_id
│   ├── metric
│   ├── source
│   ├── observed_at
│   ├── timeframe
│   ├── quality_status          (quality state at time of calculation)
│   └── freshness_status        (freshness state at time of calculation)
├── algorithm_version           (structured version — see §8)
├── parameter_version           (algorithm parameters version)
├── schema_version              (input/output schema version)
├── calculated_at               (wall-clock calculation time)
├── input_window                (e.g., "200D daily closes from BINANCE_SPOT")
├── total_inputs_expected       (how many observations were expected)
├── total_inputs_used           (how many were included after quality gating)
└── excluded_inputs[]           (observation identities excluded and why)
```

### 7.2 Provenance Is Immutable

Once a feature record is persisted, its provenance is fixed. Recalculation produces a new record with new `calculated_at` and potentially different provenance.

### 7.3 Backward-Compatible Provenance Extension

The existing `sourceProvenance` JSONB in the `features` table is a legacy structure. P6-02B extends (not replaces) it by adding:

- `input_observations[]` — array of observation identity references
- `quality_summary` — aggregate quality states
- `freshness_summary` — aggregate freshness states
- `algorithm_version` — structured version tuple

Existing fields (`sources`, `indicators`, `calculated_at`, `confidence`) remain for P4/P5 backward compatibility.

**DF-05:** Existing `sourceProvenance` fields MUST remain readable by P4/P5 consumers. New fields are additive.

---

## 8. Versioning

### 8.1 Structured Version Tuple

**DF-06:** Every Derived Feature calculation MUST be traceable to a structured version tuple:

```
FeatureVersionTuple = {
    algorithm_version: string,     // e.g., "1.0.0"
    parameter_version: string,     // e.g., "1.0.0"  
    schema_version: string,        // e.g., "1.0.0"
    config_hash: string            // SHA-256 of non-versioned config (weights, thresholds)
}
```

### 8.2 Version Field Definitions

| Field | Definition | When It Changes |
|---|---|---|
| `algorithm_version` | Core algorithm logic | Any change to scoring formula, indicator calculation, or aggregation logic |
| `parameter_version` | Tunable parameters | Changes to weights, thresholds, MA periods, ROC periods, etc. |
| `schema_version` | Input/output shape | Changes to feature input contract or output structure |
| `config_hash` | Deterministic hash of full config | Any config change not captured by structured versions |

### 8.3 Relationship to Existing Versioning

| Existing Mechanism | P6-02B Mapping |
|---|---|
| `feature_versions.version` (integer) | Maps to `algorithm_version` |
| `feature_versions.algorithm` (JSONB) | Must be decomposed into structured tuple |
| `score_configs` | Maps to `parameter_version` + `config_hash` |
| `rule_versions` | Separate concern (P5); not part of feature version |

**PD-4 (PLANNER DECISION REQUIRED):** Whether to migrate existing `feature_versions` to structured tuples or create parallel P6 versioning. Options:
- A: Extend existing table with new columns
- B: Create new `p6_feature_versions` table
- C: Embed version tuple in feature record provenance only

### 8.4 Version Reproducibility

Given the same `(algorithm_version, parameter_version, schema_version, config_hash)` and the same canonical observation inputs, the feature output MUST be deterministic.

This is a contract requirement, not an implementation guarantee — the implementation must prove determinism through testing.

---

## 9. Health Dimensions

### 9.1 Dimension Model

The current health score is a weighted sum of four feature scores. P6-02B formalizes these as named Health Dimensions:

```
HealthDimension
├── name                  (dimension identifier)
├── feature_name          (primary feature feeding this dimension)
├── weight                (contribution to health score)
├── range                 (min, max output range)
├── missing_behavior      (what happens when input is unavailable)
├── quality_gating        (how quality affects this dimension)
└── freshness_weighting   (how freshness affects this dimension)
```

### 9.2 V1 Health Dimensions

| Dimension | Feature | Weight Range | Missing Behavior | Notes |
|---|---|---|---|---|
| `TREND` | TREND score | PD-5 | Returns neutral (50) | EMA-based price trend |
| `MOMENTUM` | MOMENTUM score | PD-5 | Returns neutral (50) | ROC + ATR based |
| `VOLUME` | VOLUME score | PD-5 | Returns neutral (50) | MA-20 volume ratio |
| `DERIVATIVE` | DERIVATIVE score | PD-5 | Returns neutral (50) if no futures; partial if OI/FR partial | OI + Funding Rate |

**PD-5 (PLANNER DECISION REQUIRED):** Exact weight distribution for health dimensions. Options:
- A: Equal weights (25% each)
- B: Configurable per version (current behavior via `scoreConfigs`)
- C: Dynamic based on data availability
- D: Worst-case floor (health ≤ min dimension)

### 9.3 Health Score Composition

```
health_score = Σ(dimension_weight × dimension_score) / Σ(dimension_weight)
```

Where:
- `dimension_score` = feature output (0–100)
- `dimension_weight` = from PD-5
- Neutral default (50) used when dimension input is unavailable

### 9.4 Dimension Decomposition Requirement

**DF-07:** The health score MUST be decomposable into its constituent dimensions. Every `health_score` record must include:

- Per-dimension score
- Per-dimension weight
- Per-dimension data availability
- Overall data_completeness

This is currently partially implemented via `weightBreakdown` JSONB. P6-02 formalizes it.

### 9.5 Health Dimensions MUST NOT Become Observations

**DF-08:** Health dimensions, health scores, and all composite outputs are DERIVED layer. They are NEVER canonical observations. They do NOT have observation identity. They do NOT have quality_status or freshness_status (they inherit from inputs).

---

## 10. V1 Feature Vocabulary

### 10.1 Feature Classification

| Type | Definition | Examples |
|---|---|---|
| **Raw Feature** | Single-metric derived from canonical observations | EMA(20), MA(20), ROC(14), ATR(14), OI_change_pct |
| **Composite Feature** | Multi-metric aggregation of raw features | TREND score, VOLUME score, MOMENTUM score, DERIVATIVE score |
| **Score** | Numeric output (0–100) from composite feature | trend_score, volume_score, momentum_score, derivative_score |
| **Aggregate Score** | Score computed from other scores | health_score, confidence_score |
| **Narrative Aggregate** | Score computed across coins | narrative_health |

### 10.2 V1 Vocabulary (Frozen from Existing Implementation)

**DF-09:** The V1 feature vocabulary is exactly:

| Feature Name | Type | Input Metrics | Algorithm | Output Range |
|---|---|---|---|---|
| `TREND` | Composite Score | CLOSE | EMA-20/50/200 relationship scoring | 0–100 |
| `VOLUME` | Composite Score | VOLUME | MA-20 volume ratio scoring | 0–100 |
| `MOMENTUM` | Composite Score | CLOSE, HIGH, LOW | ROC-14 + ATR-14 weighted | 0–100 |
| `DERIVATIVE` | Composite Score | OPEN_INTEREST, FUNDING_RATE | OI change + FR scoring | 0–100 |
| `HEALTH` | Aggregate Score | TREND+DERIVATIVE+VOLUME+MOMENTUM | Weighted sum | 0–100 |
| `CONFIDENCE` | Aggregate | Quality metadata + source availability | Weighted source×quality | 0–100 |

### 10.3 Feature NOT in Vocabulary

The following are NOT V1 features. They are NOT to be added without explicit planner decision:

- `BREADTH` (cross-coin metric)
- `PARTICIPATION` (cross-coin metric)
- `RELATIVE_STRENGTH` (cross-coin comparison)
- `PERSISTENCE` (temporal stability)
- `CORRELATION` (cross-asset)
- Any trading signal or BUY/SELL semantics

### 10.4 Feature ≠ Observation Boundary

**DF-10:** No feature output may be stored in observation tables or treated as a canonical observation. Features live in `features`, `health_scores`, and related derived tables. They are NEVER observations.

---

## 11. Backward Compatibility

### 11.1 Protected Consumers

| Consumer | What It Reads | P6-02 Obligation |
|---|---|---|
| `/api/coins/[id]` | `features`, `health_scores`, `recommendations` | Column values must remain compatible |
| `/api/coins/[id]/decision` | `health_scores` | Score range (0–100) must remain |
| `/api/narratives/[id]` | `features`, `health_scores`, `narrative_health` | All fields must remain readable |
| `/api/dashboard` | `health_scores`, `recommendations` | Score/signal values must remain |
| P4 interpretation engine | Feature data indirectly | Must continue to receive compatible feature shapes |
| P5 rule engine | Score fields via `ScoreInput` | Must continue to receive compatible score values |
| P5 replay engine | Persisted artifacts | Must NOT break historical artifact format |

### 11.2 Schema Compatibility

**DF-11:** Existing `features`, `health_scores`, `recommendations`, and `narrative_health` table schemas MAY be extended with new columns but existing columns MUST NOT be removed, renamed, or have their semantic meaning changed.

### 11.3 Score Range Compatibility

All feature scores and health scores MUST remain in the 0–100 range. This is a contract with P4/P5 consumers.

### 11.4 Signal Compatibility

Recommendation signals MUST remain: `STRONG_WATCH`, `WATCH`, `OBSERVE`, `WEAK`. This is a contract with P5 rule engine.

### 11.5 P4/P5 Semantic Boundary

**DF-12:** P6-02 MUST NOT introduce:

- BUY/SELL semantics
- Trading execution logic
- Risk management policies
- Position sizing
- Entry/exit thresholds
- Any P5 decision semantics beyond what already exists

---

## 12. Planner Decision Inventory

| ID | Question | Evidence | Options | Recommended | Consequence | Dependency | Status |
|---|---|---|---|---|---|---|---|
| PD-1 | Confidence weighting formula for quality-aware confidence? | P6-02A G-8; current source-availability-only | A: Binary penalty, B: Proportional, C: Per-metric weighted | B (proportional) — simplest, most granular | Affects confidence_score values consumed by P5 | Feature input contract | PLANNER DECISION REQUIRED |
| PD-2 | Threshold for degraded feature output with mixed-quality inputs? | P6-02A G-2; current no-threshold behavior | A: No threshold, B: Minimum data threshold, C: Per-feature configurable | A (no threshold) — preserve existing behavior | Affects feature availability with sparse data | PD-1 | PLANNER DECISION REQUIRED |
| PD-3 | STALE observation weight multiplier? | P6-02A G-3; freshness not consumed today | A: Binary 0.5, B: Linear decay, C: Per-feature configurable, D: No weighting V1 | D (no weighting V1) — defer complexity | Affects feature output with stale data | P6-01C freshness | PLANNER DECISION REQUIRED |
| PD-4 | Version tuple storage: extend existing, parallel table, or provenance-only? | P6-02A G-4; feature_versions exists | A: Extend feature_versions, B: New p6_feature_versions, C: Provenance only | B (parallel table) — clean separation from legacy | Affects reproducibility infrastructure | None | PLANNER DECISION REQUIRED |
| PD-5 | Health dimension weight distribution? | P6-02A G-7; current via scoreConfigs | A: Equal, B: Configurable, C: Dynamic, D: Worst-case floor | B (configurable) — preserves current behavior | Affects health_score values | PD-4 | PLANNER DECISION REQUIRED |
| PD-6 | Input source priority when multiple sources provide same metric? | P6-02A CD-1; P6-01C out-of-scope | A: Latest wins, B: Priority-based, C: Average, D: No priority V1 | D (no priority V1) — multiple sources contribute independently | Affects multi-source feature calculation | P6-01C source priority | PLANNER DECISION REQUIRED |
| PD-7 | Whether to migrate legacy feature pipeline or build new P6-native pipeline? | P6-02A G-1, G-6; feature engine is monolithic | A: Adapt existing, B: Build new alongside, C: Gradual migration | B (build new alongside) — cleaner boundary; legacy serves P4/P5 until switchover | Affects architecture and backward compatibility | PD-1…PD-6 | PLANNER DECISION REQUIRED |
| PD-8 | Narrative health calculation: where does it live in P6? | P6-03A; currently in refresh route | A: P6-02 module, B: Stay in refresh route, C: Separate P6-03 module | A (P6-02 module) — natural home for derived health aggregation | Affects narrative_health computation location | PD-5, PD-7 | PLANNER DECISION REQUIRED |

---

## 13. Derived Feature Invariants

| ID | Invariant | Rationale | Violation Classification |
|---|---|---|---|
| **DF-01** | Feature identity MUST NOT be confused with observation identity | Prevents semantic leakage between layers | CLASS-A |
| **DF-02** | Every feature input MUST trace to canonical observation identity | Ensures P6-01B identity chain is maintained | CLASS-A |
| **DF-03** | Quality gating MUST NOT create new QualityState values | P6-01D frozen vocabulary | CLASS-A |
| **DF-04** | Freshness MUST NOT be converted into quality states | P6-01B independence of dimensions | CLASS-A |
| **DF-05** | Existing `sourceProvenance` fields MUST remain readable by P4/P5 | Backward compatibility | CLASS-A |
| **DF-06** | Every feature calculation MUST be traceable to a version tuple | Reproducibility requirement | CLASS-B |
| **DF-07** | Health score MUST be decomposable into constituent dimensions | Transparency and debugging | CLASS-B |
| **DF-08** | Health dimensions MUST NOT become canonical observations | Layer boundary protection | CLASS-A |
| **DF-09** | V1 feature vocabulary is frozen to TREND/VOLUME/MOMENTUM/DERIVATIVE/HEALTH/CONFIDENCE | Scope control | CLASS-B |
| **DF-10** | No feature output may be stored in observation tables | Layer separation | CLASS-A |
| **DF-11** | Existing table schemas MAY extend but MUST NOT remove/rename columns | Backward compatibility | CLASS-A |
| **DF-12** | P6-02 MUST NOT introduce BUY/SELL or P5 decision semantics | P4/P5 boundary | CLASS-A |
| **DF-13** | Feature calculation MUST be deterministic given same inputs and version | Reproducibility | CLASS-B |
| **DF-14** | Feature MUST NOT read from legacy tables as semantic source-of-truth | P6 canonical observation consumption | CLASS-A |
| **DF-15** | Quality INVALID does NOT automatically block feature calculation | PD-2 dependent; INVALID is exclusion, not blocking | CLASS-B |
| **DF-16** | Feature MUST NOT auto-correct, interpolate, or synthesize missing values | No auto-correction per P6-01D | CLASS-A |

---

## 14. Evidence Gaps

| # | Gap | Why Needed | Resolution |
|---|---|---|---|
| E-1 | Production `features` table row count and distribution | Migration planning | Production DB query |
| E-2 | P4 explanation engine exact dependency on feature fields | Backward compatibility verification | P4 code audit |
| E-3 | P5 rule engine exact dependency on score fields | Backward compatibility verification | P5 code audit |
| E-4 | Actual production coin count and refresh frequency | Performance planning | Production monitoring |
| E-5 | Whether any external consumer reads feature data via API | API contract stability | API audit |
| E-6 | Exact `feature_versions.algorithm` JSONB structure | Version migration planning | Schema inspection |
| E-7 | `scoreConfigs` current values and usage pattern | Parameter versioning baseline | DB query |

---

## 15. Non-Scope

This contract explicitly does NOT define:

- Feature calculation implementation (P6-02C/D)
- Feature persistence schema changes (P6-02D)
- Snapshot identity or persistence (P6-02E)
- Narrative health algorithm (P6-02E or P6-03)
- Cross-coin features (breadth, participation, relative_strength) — future P6
- Temporal tolerance (OI-02) — deferred
- Funding rate range (OI-01) — deferred
- Mixed VALID+MISSING aggregation (OI-08) — deferred
- Any P3/P4/P5 semantic changes

---

## 16. Relationship to Frozen P6-01 Contracts

| P6-01 Contract | P6-02B Relationship | Boundary |
|---|---|---|
| P6-01B Observation Identity | P6-02B features READ observations; features do NOT produce observations | STRICT — features are downstream |
| P6-01C Source Vocabulary | P6-02B features use source identity for provenance only | STRICT — features do NOT define sources |
| P6-01C Freshness | P6-02B features MAY use freshness for weighting (PD-3) | OPTIONAL — V1 may ignore |
| P6-01D Quality | P6-02B features consume quality_status for gating (§5) | STRICT — D2 remains sole authority |
| P6-01D OI-01…OI-08 | P6-02B does NOT resolve any OI items | STRICT — OI items are deferred |

---

## 17. Acceptance Checklist

- [x] Feature identity defined and distinguished from observation identity
- [x] Input contract specifies canonical observation consumption
- [x] Quality gating rules defined using frozen QualityState vocabulary
- [x] Freshness interaction defined as independent dimension
- [x] Provenance contract specifies minimum required fields
- [x] Versioning model structured as version tuple
- [x] V1 feature vocabulary frozen (6 features)
- [x] Health dimensions formalized (4 dimensions)
- [x] Backward compatibility explicitly protected
- [x] Planner Decision Inventory complete (8 decisions)
- [x] Derived Feature invariants defined (16 invariants)
- [x] Evidence gaps documented
- [x] Non-scope explicitly defined
- [x] No production code modified
- [x] No schema/migration changes
- [x] No P6-01 contract modifications
- [x] No P3/P4/P5 modifications
- [x] No semantic decisions made by agent
