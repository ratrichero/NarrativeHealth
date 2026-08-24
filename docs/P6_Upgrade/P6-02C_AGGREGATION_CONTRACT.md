# P6-02C — Derived Feature Aggregation Contract

**Date:** 2026-08-26
**Task Type:** CONTRACT DESIGN DOCUMENT ONLY — NO IMPLEMENTATION, NO SCHEMA, NO MIGRATION
**Baseline:** P6-02B Derived Feature Contract (`17b6beb`)
**Frozen Authorities:** P6-01B (ad5d7df), P6-01C (various), P6-01D (frozen), P6-01E (62b5ee2), P6-01-FINAL (8a1db6e), P6-02A (3ed1714), P6-02B (17b6beb)
**Git boundary:** ONLY this document. No production code. No schema. No P3/P4/P5 changes. No P6-01 contract changes. No P6-02B changes.

---

## 1. Purpose

This document defines the **Aggregation Contract** — the deterministic rules governing how canonical P6 observations are aggregated into derived features, how features are aggregated into health dimensions, and how dimensions are aggregated into composite health and confidence scores.

The contract specifies:

- Aggregation grain and pipeline
- State propagation matrix (quality + freshness through aggregation layers)
- Mixed-state handling (VALID + MISSING, VALID + UNKNOWN, INVALID exclusion)
- Full-input-unavailable behavior
- Freshness weighting interaction with quality gating
- Missing-input policy
- Deterministic aggregation rules
- Version propagation through aggregation layers
- Provenance propagation
- Confidence calculation boundary
- Rounding/precision rules
- Partial feature availability
- Timeframe/window compatibility

**This is a contract design document.** It does not implement, migrate, or modify any production code.

---

## 2. Frozen Dependencies

| Document | Commit | What It Freezes | Relevance to P6-02C |
|---|---|---|---|
| P6-01B | ad5d7df | Canonical observation identity, QualityState (VALID/INVALID/MISSING/UNKNOWN), Timeframe (DAILY/4H/SOURCE_SNAPSHOT) | Input vocabulary for aggregation |
| P6-01C | various | FreshnessState (FRESH/STALE/UNKNOWN), source vocabulary | Freshness weighting input |
| P6-01D | frozen | D2 sole quality authority, QualityState frozen, OI-01…OI-08 unresolved | Quality gate rules |
| P6-01E | 62b5ee2 | Production kline wiring | Production data source |
| P6-02A | 3ed1714 | Feature landscape recon, gap analysis | Architecture context |
| P6-02B | 17b6beb | Feature identity, input contract, quality gating §5, freshness interaction §6, provenance §7, versioning §8, V1 vocabulary §10, health dimensions §9, invariants DF-01…DF-16 | Direct upstream contract |

**Critical rule:** This contract MUST NOT modify any frozen authority above. If a conflict is discovered, STOP and report change-control.

---

## 3. Terminology

| Term | Definition | Source |
|---|---|---|
| **Observation** | A canonical P6 measurement: `(entity_id, metric, source, observed_at, timeframe)` | P6-01B §3.2 |
| **QualityState** | `VALID \| INVALID \| MISSING \| UNKNOWN` | P6-01B §9.1, P6-01D frozen |
| **FreshnessState** | `FRESH \| STALE \| UNKNOWN` | P6-01C §4.1 |
| **Raw Feature** | Single-metric intermediate (EMA, MA, ROC, ATR, OI_change_pct) | P6-02B §10.1 |
| **Composite Feature** | Multi-metric score (TREND, VOLUME, MOMENTUM, DERIVATIVE) | P6-02B §10.1 |
| **Score** | Numeric output 0–100 from composite feature | P6-02B §10.1 |
| **Aggregate Score** | Score computed from other scores (HEALTH, CONFIDENCE) | P6-02B §10.1 |
| **Health Dimension** | Named component of health score (TREND, MOMENTUM, VOLUME, DERIVATIVE) | P6-02B §9 |
| **Aggregation** | The process of combining inputs into a higher-level output | This document |
| **Data Completeness** | Proportion of expected inputs that were included after gating | P6-02B §4.5 |
| **Exclusion** | An observation removed from aggregation due to quality gate | P6-02B §5.2 |
| **Neutral Default** | Score value 50 used when dimension input is unavailable | P6-02B §9.3 |

---

## 4. Aggregation Model

### 4.1 Aggregation Grain

The aggregation pipeline has four distinct grains:

```
Layer 0: Canonical Observation
    (entity_id, metric, source, observed_at, timeframe)
    ↓ quality gate + freshness weight
Layer 1: Raw Feature
    (entity_id, raw_feature_name, timeframe, calc_window)
    EMA(20), MA(20), ROC(14), ATR(14), OI_change_pct, FR_value
    ↓ algorithm computation
Layer 2: Composite Feature / Score
    (entity_id, feature_name, timeframe, calc_window, algorithm_version)
    TREND, VOLUME, MOMENTUM, DERIVATIVE
    ↓ quality metadata propagation
Layer 3: Aggregate Score
    (entity_id, aggregate_name, algorithm_version, parameter_version)
    HEALTH, CONFIDENCE
    ↓ dimension decomposition
Layer 4: Health Dimensions
    (entity_id, dimension_name, weight, score)
    TREND_dim, MOMENTUM_dim, VOLUME_dim, DERIVATIVE_dim
```

### 4.2 Pipeline Direction

```
Observations (L0)
    → [quality gate] → [freshness weight]
    → Raw Features (L1)
    → [algorithm] → Composite Features (L2)
    → [quality metadata aggregation] → Aggregate Scores (L3)
    → [dimension decomposition] → Health Dimensions (L4)
    → [provenance assembly] → Persisted Record
```

### 4.3 Critical Boundaries

**DF-A-01:** Each aggregation layer MUST have distinct identity semantics. Layer 0 uses observation identity; Layers 1–3 use feature identity (P6-02B §3). Layers must NOT be conflated.

**DF-A-02:** Aggregation proceeds in strict layer order. A layer N output MUST NOT be used as input to a layer < N computation (no feedback loops).

---

## 5. State Propagation Matrix

### 5.1 Quality State Propagation

Quality states propagate through aggregation as **metadata**, not as values. Quality does not change during aggregation — it is carried forward as provenance.

| Source State | Propagation to L1 | Propagation to L2 | Propagation to L3 | Propagation to L4 |
|---|---|---|---|---|
| `VALID` | INCLUDED; quality_status = VALID in provenance | Carried in input_observations[] | Aggregated into quality_summary | Inherited by dimension |
| `INVALID` | EXCLUDED from calculation; recorded in excluded_inputs[] | Not present (was excluded at L0→L1) | Quality_summary notes exclusion count | Quality_summary notes exclusion count |
| `MISSING` | EXCLUDED from calculation; recorded in excluded_inputs[] | Not present (was excluded at L0→L1) | Quality_summary notes exclusion count | Quality_summary notes exclusion count |
| `UNKNOWN` | INCLUDED; quality_status = UNKNOWN in provenance | Carried in input_observations[] | Aggregated into quality_summary | Inherited by dimension |

### 5.2 Freshness State Propagation

Freshness states propagate through aggregation as **weighting signals**, not as values. Freshness does not change during aggregation.

| Source State | Weight Multiplier (L0→L1) | Propagation to L2+ |
|---|---|---|
| `FRESH` | 1.0 (full weight) | Recorded in provenance |
| `STALE` | PD-6 (PLANNER DECISION) | Recorded in provenance |
| `UNKNOWN` | 1.0 (full weight) | Recorded in provenance |

**PD-6 (PLANNER DECISION REQUIRED):** STALE observation weight multiplier for aggregation. This is the same question as P6-02B PD-3 — formally recorded here for the aggregation context. Options:
- A: Binary (STALE = 0.5)
- B: Linear decay (age / stale_after ratio)
- C: Per-feature configurable
- D: No weighting (ignore freshness in V1)

### 5.3 Combined Quality × Freshness Interaction

| QualityState | FreshnessState | Feature Inclusion | Weight | Effect |
|---|---|---|---|---|
| VALID | FRESH | INCLUDED | 1.0 | Full contribution |
| VALID | STALE | INCLUDED | PD-6 | Reduced contribution |
| VALID | UNKNOWN | INCLUDED | 1.0 | Full contribution (cannot determine staleness) |
| INVALID | * | EXCLUDED | 0 | Not used; recorded in excluded_inputs |
| MISSING | * | EXCLUDED | 0 | Not used; recorded in excluded_inputs |
| UNKNOWN | FRESH | INCLUDED | 1.0 | Full contribution (quality undetermined) |
| UNKNOWN | STALE | INCLUDED | PD-6 | Reduced contribution (quality undetermined) |
| UNKNOWN | UNKNOWN | INCLUDED | 1.0 | Full contribution (neither determined) |

**DF-A-03:** Quality and freshness are orthogonal. A VALID observation remains VALID regardless of freshness. A FRESH observation remains FRESH regardless of quality. Neither dimension converts into the other.

---

## 6. Mixed-State Handling

### 6.1 VALID + MISSING

When some observations for a feature are VALID and others are MISSING:

- VALID observations are included with full weight
- MISSING observations are excluded from calculation
- `data_completeness` = (count of VALID + UNKNOWN) / (total expected observations) × 100
- Feature is computed from the VALID subset only
- Provenance records both included and excluded observations

**DF-A-04:** MISSING observations MUST NOT be replaced with interpolated, synthetic, or default values. The feature is computed from available valid data only.

### 6.2 VALID + UNKNOWN

When some observations have quality_status = UNKNOWN and others = VALID:

- UNKNOWN observations are included with full weight (P6-02B §5.2)
- VALID observations are included with full weight
- `data_completeness` counts both VALID and UNKNOWN as "usable"
- Feature is computed from both VALID + UNKNOWN observations
- Provenance notes that quality was not evaluated for UNKNOWN inputs

**DF-A-05:** UNKNOWN quality MUST NOT be treated as INVALID. UNKNOWN means quality was not determined; the observation is usable.

### 6.3 INVALID Exclusion

When observations are INVALID:

- INVALID observations are excluded from feature calculation
- The exclusion is recorded in `excluded_inputs[]` with reason (check_id from D2)
- Each metric's quality gates only that metric — INVALID CLOSE does not exclude VOLUME from the same observation
- `data_completeness` reflects exclusion

**DF-A-06:** INVALID exclusion is per-metric, not per-observation. An INVALID OHLC group does not invalidate VOLUME or QUOTE_VOLUME from the same observation.

### 6.4 All Inputs Unavailable

When ALL expected observations for a feature are unavailable (all MISSING, all INVALID, or insufficient count):

| Feature | Behavior | data_completeness |
|---|---|---|
| TREND | Returns neutral default: score = 50, detail with zeroed EMAs | 0 |
| VOLUME | Returns neutral default: score = 50, detail with zeroed volumes | 0 |
| MOMENTUM | Returns neutral default: score = 50, detail with zeroed ROC/ATR | 0 |
| DERIVATIVE | Returns neutral default: score = 50, no_futures = true | 0 |
| HEALTH | Computed from available dimensions; unavailable dimensions use neutral (50) | Weighted average of available |
| CONFIDENCE | Returns 0 (no data to base confidence on) | 0 |

**DF-A-07:** When all inputs are unavailable, the feature MUST return a deterministic neutral default (score = 50) — NOT null, NOT undefined, NOT an error. This preserves backward compatibility with P4/P5 consumers that expect numeric scores.

### 6.5 Partial Feature Availability

When some composite features are available but others are not:

- HEALTH aggregation uses available dimensions with their weights
- Unavailable dimensions contribute neutral (50) at their configured weight
- `data_completeness` reflects the proportion of available dimensions
- CONFIDENCE is computed from the full quality/freshness metadata regardless of feature availability

**DF-A-08:** HEALTH MUST NOT fail or return null when some dimensions are unavailable. It MUST produce a numeric score from whatever dimensions are available.

---

## 7. Freshness Weighting in Aggregation

### 7.1 Weight Application Point

Freshness weighting is applied at the **observation → raw feature** boundary (L0 → L1), NOT at later aggregation stages.

```
Observation (quality_status = VALID, freshness_status = STALE)
    ↓ weight = PD-6 (e.g., 0.5)
    ↓ contribution = value × weight
Raw Feature input
```

### 7.2 Weight Propagation

Freshness weights are NOT propagated forward as separate fields. They are embedded in the contribution of each observation to the raw feature. The raw feature output is a single numeric value that already reflects freshness weighting.

### 7.3 Freshness Does NOT Gate

**DF-A-09:** Freshness MUST NOT prevent feature calculation. A feature is computed if sufficient valid inputs exist, regardless of freshness. Freshness affects weighting (how much each observation contributes), NOT whether the feature is produced.

### 7.4 Mixed Freshness in Feature Window

When a feature window contains observations with different freshness states:

- Each observation is weighted by its own freshness state
- FRESH observations contribute at full weight
- STALE observations contribute at reduced weight (PD-6)
- UNKNOWN observations contribute at full weight
- The feature output reflects the weighted combination

---

## 8. Missing-Input Policy

### 8.1 Minimum Data Requirements

| Feature | Absolute Minimum | Recommended | Below Minimum Behavior |
|---|---|---|---|
| TREND | 20 observations | 200 | Returns neutral (50) with reduced data_completeness |
| VOLUME | 1 observation | 20 | Returns computed score if ≥1; neutral if 0 |
| MOMENTUM | 15 observations | 15 | Returns neutral (50) if <15 |
| DERIVATIVE | 0 (no futures) or 2 (OI current + prev) | 2 | Returns neutral (50) if no futures data |
| HEALTH | 0 dimensions | 4 dimensions | Returns neutral (50) from available dimensions |
| CONFIDENCE | 0 | All sources | Returns 0 if no quality metadata available |

### 8.2 Data Completeness Calculation

```
data_completeness = (observations_included / observations_expected) × 100
```

Where:
- `observations_included` = count of VALID + UNKNOWN observations after quality gate
- `observations_expected` = total observations that SHOULD exist for this feature (e.g., 200 for TREND daily)

### 8.3 Minimum Threshold for Feature Production

**PD-7 (PLANNER DECISION REQUIRED):** Whether to enforce a minimum data_completeness threshold before producing a feature. Options:
- A: No threshold — always produce feature from available data (current behavior)
- B: Hard threshold — return neutral default below N%
- C: Soft threshold — produce feature but flag as degraded

---

## 9. Deterministic Aggregation

### 9.1 Determinism Contract

**DF-A-10:** Given identical inputs (same canonical observations with same quality/freshness states) and same algorithm/parameter version, the aggregation output MUST be identical.

This applies to:
- L0 → L1: Same observations → same raw features
- L1 → L2: Same raw features → same composite scores
- L2 → L3: Same composite scores → same aggregate scores
- L3 → L4: Same aggregate scores → same health dimensions

### 9.2 Floating-Point Determinism

**DF-A-11:** All aggregation arithmetic MUST produce deterministic results. This requires:
- Consistent ordering of input processing (sorted by `observed_at`)
- No parallel/dynamic ordering that could produce different results
- Consistent rounding rules (see §12)

### 9.3 Reproducibility

A feature calculation is reproducible if and only if:

1. Same canonical observation values are available
2. Same quality_status per observation
3. Same freshness_status per observation
4. Same algorithm_version
5. Same parameter_version
6. Same config_hash
7. Same calc_window (same number and ordering of observations)

If all seven conditions hold, the output MUST be identical.

---

## 10. Version Propagation

### 10.1 Version Tuple Flow

```
L0 (Observations)
    ↓ no version (observations are raw data)
L1 (Raw Features)
    ↓ algorithm_version = "1.0.0"
    ↓ parameter_version = "1.0.0"
L2 (Composite Features)
    ↓ algorithm_version = "1.0.0"
    ↓ parameter_version = "1.0.0"
    ↓ schema_version = "1.0.0"
L3 (Aggregate Scores)
    ↓ algorithm_version = "1.0.0"
    ↓ parameter_version = "1.0.0"
    ↓ config_hash = SHA-256 of weights
L4 (Health Dimensions)
    ↓ inherits from L3
```

### 10.2 Version Independence

Each aggregation layer MAY have independent version tuples. Changing the TREND algorithm (L2) does not require changing the HEALTH aggregation formula (L3).

### 10.3 Version Change Semantics

| Change Type | Version Impact | Recalculation Required |
|---|---|---|
| Algorithm logic change | algorithm_version incremented | Yes — all dependent features |
| Weight/threshold change | parameter_version incremented | Yes — all dependent aggregates |
| Input shape change | schema_version incremented | Yes — all dependent features |
| Config change (non-versioned) | config_hash updated | Yes — all dependent aggregates |

**DF-A-12:** A version change at any layer MUST trigger recalculation of all downstream layers.

---

## 11. Provenance Propagation

### 11.1 Provenance Assembly

Provenance is assembled at each aggregation layer and carried forward:

```
L1 Provenance:
    input_observations[] = raw observation identities used
    algorithm_version = L1 algorithm
    quality_per_input[] = quality_status per observation
    freshness_per_input[] = freshness_status per observation
    excluded_inputs[] = observations excluded and why
    total_expected = expected observation count
    total_used = observations included after gating

L2 Provenance:
    inherits L1 provenance
    + L2 algorithm_version
    + raw_feature_inputs[] = L1 outputs consumed

L3 Provenance:
    inherits L2 provenance
    + L3 algorithm_version
    + parameter_version
    + config_hash
    + composite_inputs[] = L2 outputs consumed

L4 Provenance:
    inherits L3 provenance
    + dimension_breakdown[] = per-dimension score + weight + availability
```

### 11.2 Provenance Completeness

**DF-A-13:** Every persisted aggregate record MUST contain sufficient provenance to:
1. Identify every input observation used
2. Determine the quality state of each input at calculation time
3. Determine the freshness state of each input at calculation time
4. Reproduce the calculation given the same inputs and version

### 11.3 Backward-Compatible Provenance

Existing `sourceProvenance`, `weightBreakdown`, and `reasonBreakdown` JSONB fields MUST remain populated with their current structure for P4/P5 backward compatibility.

New P6 provenance fields are additive:
- `p6_provenance` (new JSONB field) contains the full P6 aggregation trace
- Existing fields continue to serve P4/P5 consumers

---

## 12. Rounding and Precision

### 12.1 Score Precision

All composite feature scores (TREND, VOLUME, MOMENTUM, DERIVATIVE) MUST be:
- Rounded to **2 decimal places** (e.g., 72.34)
- Clamped to **[0, 100]**

### 12.2 Health Score Precision

The HEALTH aggregate score MUST be:
- Rounded to **2 decimal places**
- Clamped to **[0, 100]**

### 12.3 Confidence Score Precision

The CONFIDENCE score MUST be:
- Rounded to **1 decimal place** (e.g., 85.3)
- Clamped to **[0, 100]**

### 12.4 Intermediate Precision

Intermediate calculations (EMA, ROC, ATR, ratios) MUST use **full JavaScript number precision** (IEEE 754 double). Rounding is applied only at the final output of each aggregation layer.

### 12.5 Existing Precision Contract

**DF-A-14:** Rounding rules MUST match existing production behavior to prevent P4/P5 consumers from seeing value drift. Current implementation rounds to 2 decimal places for scores and 1 for confidence — this is preserved.

---

## 13. Timeframe and Window Compatibility

### 13.1 Single Timeframe Rule

A feature computation MUST use observations from exactly one timeframe. Mixing DAILY and 4H observations in a single feature calculation is NOT permitted.

### 13.2 Window Specification

Each feature declares its `calc_window` as a deterministic string:

| Feature | Window Format | Example |
|---|---|---|
| TREND | `{count}{timeframe}` | `200D`, `50×4H` |
| VOLUME | `{count}{timeframe}` | `20D`, `20×4H` |
| MOMENTUM | `{count}{timeframe}` | `15D`, `15×4H` |
| DERIVATIVE | `SOURCE_SNAPSHOT` or `{count}SOURCE_SNAPSHOT` | `SOURCE_SNAPSHOT`, `2×SOURCE_SNAPSHOT` |
| HEALTH | `aggregation of sub-feature windows` | `TREND:200D+VOLUME:20D+MOMENTUM:15D+DERIVATIVE:SOURCE_SNAPSHOT` |
| CONFIDENCE | `{count}{timeframe}` | `200D` |

### 13.3 Cross-Timeframe Aggregation

**DF-A-15:** HEALTH aggregation MAY combine features from different timeframes ONLY if each sub-feature explicitly declares multi-timeframe support. In V1, all features use the same timeframe as their input observations.

---

## 14. Confidence Calculation Boundary

### 14.1 Confidence Scope

CONFIDENCE is an aggregate score that measures the reliability of the feature computation, NOT the quality of the underlying data.

| Confidence Measures | Does NOT Measure |
|---|---|
| Source availability (which sources responded) | Individual observation quality |
| Quality metadata (proportion of VALID inputs) | Freshness of data |
| Freshness metadata (proportion of FRESH inputs) | Feature accuracy |
| Data completeness (expected vs actual inputs) | Market conditions |

### 14.2 Confidence Formula

```
confidence_score = Σ(source_weight × source_indicator) / Σ(source_weight)
```

Where:
- `source_weight` = from PD-1 (P6-02B)
- `source_indicator` = quality_adjusted_availability × freshness_adjusted_availability

### 14.3 PD-1 Propagation

**PD-1 (PLANNER DECISION REQUIRED — inherited from P6-02B):** The exact confidence weighting formula. In the aggregation context, this determines how quality and freshness metadata combine with source availability to produce the confidence score.

---

## 15. Planner Decision Inventory

| ID | Question | Evidence | Options | Recommended | Consequence | Dependency | Status |
|---|---|---|---|---|---|---|---|
| PD-C1 | Minimum data_completeness threshold for feature production? | P6-02B PD-2, current no-threshold behavior | A: No threshold, B: Hard threshold, C: Soft threshold | A (no threshold) — preserve existing behavior | Feature availability with sparse data | P6-02B PD-2 | PLANNER DECISION REQUIRED |
| PD-C2 | HEALTH aggregation when only 1 of 4 dimensions available? | Current behavior: weighted sum with available | A: Always compute, B: Minimum 2 dimensions, C: Return neutral if <2 | A (always compute) — preserve backward compat | Health score availability | PD-C1 | PLANNER DECISION REQUIRED |
| PD-C3 | Narrative health aggregation method? | P6-03A recon, currently market-cap weighted | A: Market-cap weighted (current), B: Equal weight, C: Confidence-weighted | A (market-cap weighted) — preserve current behavior | Narrative health values | PD-C2, P6-02B PD-5 | PLANNER DECISION REQUIRED |
| PD-C4 | Confidence: how to weight quality vs source availability? | P6-02B PD-1; current source-only | A: Source-only (V1), B: Quality-adjusted, C: Freshness-adjusted | B (quality-adjusted) — meaningful improvement | Confidence score values | P6-02B PD-1 | PLANNER DECISION REQUIRED |
| PD-C5 | Stale observation weight multiplier for aggregation? | P6-02B PD-3/6; freshness not consumed today | A: Binary 0.5, B: Linear decay, C: Per-feature, D: No weighting V1 | D (no weighting V1) — defer complexity | Feature output with stale data | P6-01C freshness | PLANNER DECISION REQUIRED |
| PD-C6 | Minimum dimension count for HEALTH to be "confident"? | No prior evidence | A: No minimum, B: ≥2 dimensions, C: Configurable | A (no minimum) — preserve backward compat | Health score availability | PD-C2 | PLANNER DECISION REQUIRED |

**Note:** PD-C1 maps to P6-02B PD-2. PD-C5 maps to P6-02B PD-3/6. These are formally recorded in the aggregation context for completeness. Decisions are shared, not duplicated.

---

## 16. Evidence Gaps

| # | Gap | Why Needed | Resolution |
|---|---|---|---|
| AG-1 | Production refresh duration with quality-aware aggregation | Performance validation | Production measurement (NB-1 from P6-01E) |
| AG-2 | Exact P4 explanation engine dependency on confidence_score format | Backward compatibility | P4 code audit |
| AG-3 | Exact P5 rule engine dependency on score precision | Backward compatibility | P5 code audit |
| AG-4 | Current narrative health weighting method (market-cap vs equal) | PD-C3 decision | Production code inspection |
| AG-5 | Whether any consumer depends on data_completeness = 100 for "healthy" data | PD-C1 decision | API audit |
| AG-6 | Interaction between quality gating and DERIVATIVE (no futures = neutral) | Edge case behavior | Edge case specification |

---

## 17. Invariants

| ID | Invariant | Rationale | Violation |
|---|---|---|---|
| **DF-A-01** | Aggregation layers MUST have distinct identity semantics | Prevents layer confusion | CLASS-A |
| **DF-A-02** | Aggregation MUST proceed in strict layer order (no feedback loops) | Prevents circular dependencies | CLASS-A |
| **DF-A-03** | Quality and freshness MUST remain orthogonal through all layers | P6-01B independence | CLASS-A |
| **DF-A-04** | MISSING observations MUST NOT be interpolated or synthesized | No auto-correction (P6-01D) | CLASS-A |
| **DF-A-05** | UNKNOWN quality MUST NOT be treated as INVALID | P6-01D frozen vocabulary | CLASS-A |
| **DF-A-06** | INVALID exclusion MUST be per-metric, not per-observation | Metric-level quality gating | CLASS-B |
| **DF-A-07** | All-inputs-unavailable MUST return deterministic neutral (50), not null/error | Backward compatibility | CLASS-A |
| **DF-A-08** | HEALTH MUST NOT fail when some dimensions are unavailable | Backward compatibility | CLASS-A |
| **DF-A-09** | Freshness MUST NOT prevent feature calculation | Freshness is weighting, not gating | CLASS-B |
| **DF-A-10** | Same inputs + same version MUST produce identical output | Determinism | CLASS-B |
| **DF-A-11** | Aggregation arithmetic MUST be deterministic (consistent ordering) | Reproducibility | CLASS-B |
| **DF-A-12** | Version change at any layer MUST trigger downstream recalculation | Version integrity | CLASS-B |
| **DF-A-13** | Every aggregate record MUST contain sufficient provenance for reproduction | Auditability | CLASS-B |
| **DF-A-14** | Rounding MUST match existing production behavior | P4/P5 compatibility | CLASS-A |
| **DF-A-15** | Cross-timeframe aggregation MUST be explicit per feature | Prevents implicit mixing | CLASS-B |
| **DF-A-16** | Aggregation MUST NOT auto-correct, interpolate, or synthesize values | No auto-correction per P6-01D | CLASS-A |
| **DF-A-17** | Quality summary in aggregate MUST reflect per-metric quality states, not per-observation | Metric-level granularity preserved | CLASS-B |
| **DF-A-18** | Existing P4/P5 JSONB fields (sourceProvenance, weightBreakdown, reasonBreakdown) MUST remain populated | Backward compatibility | CLASS-A |
| **DF-A-19** | Confidence MUST incorporate quality metadata, not just source availability | P6-02B §5.4 requirement | CLASS-B |
| **DF-A-20** | Narrative health aggregation MUST NOT introduce P5 decision semantics | P4/P5 boundary | CLASS-A |

---

## 18. Dependency Graph with P6-02B PD-1…PD-8

| P6-02C Item | Depends On P6-02B PD | Relationship |
|---|---|---|
| PD-C1 (min data threshold) | PD-2 (degraded output threshold) | Direct mapping — same decision |
| PD-C2 (1-dimension health) | PD-5 (health weights) | Must know weights before defining minimum |
| PD-C3 (narrative health) | PD-5, PD-7 (pipeline strategy) | Must know pipeline before defining narrative aggregation |
| PD-C4 (confidence formula) | PD-1 (quality-aware confidence) | Direct upstream |
| PD-C5 (STALE weight) | PD-3, PD-6 (freshness weighting) | Direct upstream |
| PD-C6 (dimension minimum) | PD-2, PD-5 | Depends on threshold and weight decisions |
| DF-A-06 (per-metric invalid) | PD-2 (threshold) | Invalid exclusion interacts with threshold |
| DF-A-09 (freshness not gating) | PD-3 (STALE weight) | If PD-3 = D (no weighting), freshness has no aggregation effect |

### Dependency Matrix

```
P6-02B PD-1 (confidence formula)
    └── P6-02C PD-C4

P6-02B PD-2 (degraded output threshold)
    ├── P6-02C PD-C1
    └── P6-02C PD-C6

P6-02B PD-3/6 (STALE weight)
    └── P6-02C PD-C5

P6-02B PD-5 (health weights)
    ├── P6-02C PD-C2
    └── P6-02C PD-C6

P6-02B PD-7 (pipeline strategy)
    └── P6-02C PD-C3

P6-02B PD-8 (narrative health location)
    └── P6-02C PD-C3
```

---

## 19. Non-Scope

This contract explicitly does NOT define:

- Feature calculation implementation (P6-02D)
- Feature persistence schema (P6-02D)
- Snapshot identity or persistence (P6-02E)
- Narrative health algorithm details (P6-02E or P6-03)
- Cross-coin aggregation (breadth, participation) — future P6
- Historical feature versioning (latest-only in V1)
- Temporal tolerance (OI-02) — deferred
- Funding rate range (OI-01) — deferred
- Mixed VALID+MISSING aggregation (OI-08) — deferred
- Any P3/P4/P5 semantic changes
- Implementation details (file structure, module boundaries, API design)

---

## 20. Implementation Readiness Checklist

| Item | Status | Blocking? |
|---|---|---|
| P6-02B contract frozen | YES | Required |
| QualityState vocabulary frozen | YES (P6-01D) | Required |
| FreshnessState vocabulary frozen | YES (P6-01C) | Required |
| V1 feature vocabulary defined | YES (P6-02B §10) | Required |
| Health dimensions defined | YES (P6-02B §9) | Required |
| Quality gate rules defined | YES (P6-02B §5, this §6) | Required |
| Freshness weighting defined | PD-6 PENDING | Not blocking (V1 may ignore) |
| Health weights defined | PD-C2 PENDING | Not blocking (default = equal) |
| Confidence formula defined | PD-C4 PENDING | Not blocking (V1 may use source-only) |
| Version tuple storage defined | PD-4 PENDING | Required before P6-02D |
| Pipeline strategy defined | PD-7 PENDING | Required before P6-02D |
| Provenance model defined | YES (this §11) | Required |
| Determinism requirements defined | YES (this §9) | Required |
| Rounding rules defined | YES (this §12) | Required |
| P4/P5 backward compatibility verified | PARTIAL (audit pending) | Recommended |

---

## 21. Acceptance Checklist

- [x] Aggregation grain and pipeline defined
- [x] State propagation matrix (quality + freshness) complete
- [x] Mixed-state handling (VALID+MISSING, VALID+UNKNOWN, INVALID) specified
- [x] All-inputs-unavailable behavior specified
- [x] Freshness weighting interaction with quality gating defined
- [x] Missing-input policy defined
- [x] Deterministic aggregation requirements specified
- [x] Version propagation through layers defined
- [x] Provenance propagation defined
- [x] Confidence calculation boundary defined
- [x] Rounding/precision rules specified
- [x] Timeframe/window compatibility rules specified
- [x] Planner Decision Inventory complete (6 decisions)
- [x] Evidence gaps documented (6 gaps)
- [x] Invariants defined (20 invariants)
- [x] P6-02B PD dependency graph produced
- [x] Implementation readiness assessed
- [x] No production code modified
- [x] No schema/migration changes
- [x] No P6-01 contract modifications
- [x] No P3/P4/P5 modifications
- [x] No semantic decisions made by agent
