# P6-02C1 — Aggregation Decision Inventory

**Date:** 2026-08-26
**Task Type:** DECISION ANALYSIS ONLY — no implementation, no schema, no semantic decisions
**Baseline:** P6-02B (`17b6beb`), P6-02C (`2b536b6`)
**Git boundary:** ONLY this document

---

## 1. Purpose

This document inventories every unresolved decision from P6-02B and P6-02C that must be resolved before P6-02D (implementation) can proceed. It classifies each as blocking or non-blocking, provides evidence-based proposed resolutions, and defines an implementation readiness checklist.

**This document does NOT freeze or resolve any decision.** All resolutions are PROPOSED and require Planner approval.

---

## 2. Master Decision Matrix

| ID | Source | Question | Classification | Status |
|---|---|---|---|---|
| **PD-4** | P6-02B §8.3 | Version tuple storage strategy | **BLOCKING** | PLANNER DECISION REQUIRED |
| **PD-7** | P6-02B §12 | Pipeline strategy (new alongside vs adapt) | **BLOCKING** | PLANNER DECISION REQUIRED |
| **PD-1** | P6-02B §5.4 / P6-02C §14.2 | Confidence quality-aware formula | **BLOCKING** | PLANNER DECISION REQUIRED |
| **PD-C4** | P6-02C §14.2 | Confidence quality vs source weighting | **BLOCKING** (same as PD-1) | PLANNER DECISION REQUIRED |
| **PD-5** | P6-02B §9.2 | Health dimension weight distribution | **NON-BLOCKING** | Default: equal (25% each) |
| **PD-C2** | P6-02C §6.5 | HEALTH with only 1 dimension available | **NON-BLOCKING** | Default: always compute |
| **PD-2** | P6-02B §5.5 | Minimum data threshold for feature production | **NON-BLOCKING** | Default: no threshold |
| **PD-C1** | P6-02C §8.3 | Same as PD-2 in aggregation context | **NON-BLOCKING** | Default: no threshold |
| **PD-3** | P6-02B §6.2 | STALE observation weight multiplier | **NON-BLOCKING** | Default: no weighting V1 |
| **PD-6** | P6-02C §5.2 | Same as PD-3 in aggregation context | **NON-BLOCKING** | Default: no weighting V1 |
| **PD-C5** | P6-02C §5.2 | STALE weight for aggregation | **NON-BLOCKING** (same as PD-3/6) | Default: no weighting V1 |
| **PD-6b** | P6-02B §4.7 | Multi-source priority | **NON-BLOCKING** | Default: no priority V1 |
| **PD-C3** | P6-02C §15 | Narrative health aggregation method | **NON-BLOCKING** | Default: market-cap weighted (current) |
| **PD-C6** | P6-02C §15 | Minimum dimension count for HEALTH confidence | **NON-BLOCKING** | Default: no minimum |

---

## 3. Blocking Decision Analysis

### 3.1 PD-4 — Version Tuple Storage

**Question:** How should the structured version tuple `(algorithm_version, parameter_version, schema_version, config_hash)` be stored?

**Code Evidence:**

| Artifact | Evidence | Source |
|---|---|---|
| `feature_versions` table | `id, version (integer), description, algorithm (JSONB), isActive` | Migration `0001_add_rule_versions.sql` |
| `rule_versions` table | `version, health_weights (JSONB), confidence_weights (JSONB), recommendation_thresholds (JSONB)` | Same migration |
| `score_configs` table | `configType, configKey, configValue, version, isActive` | P6-02A recon §2.1 |
| Feature engine usage | `features.versionId` FK to `feature_versions` | P6-02A recon §2.1 |

**Options Analysis:**

| Option | Pros | Cons | Risk |
|---|---|---|---|
| A: Extend `feature_versions` | No new table; existing FK preserved | Opaque JSONB `algorithm` column remains; requires migration | Schema coupling |
| B: New `p6_feature_versions` table | Clean separation; structured columns; no legacy coupling | Parallel versioning; requires FK migration from `features` | Migration complexity |
| C: Embed in provenance only | No schema change; simplest | Cannot query/version independently; version not enforced at DB level | Weak versioning |

**PROPOSED RESOLUTION:**

> **Option B (new `p6_feature_versions` table)** — Clean separation from legacy. The existing `feature_versions.algorithm` JSONB is opaque and does not support structured queries. A new P6-specific table with explicit `algorithm_version`, `parameter_version`, `schema_version`, `config_hash` columns provides:
> - Queryable, indexable version tuples
> - Independent lifecycle from legacy versioning
> - No risk to existing P4/P5 consumers (who read `features.versionId`)
>
> The existing `feature_versions` table continues to serve P4/P5. The new table is P6-only. Migration adds a `p6_version_id` FK to `features` (additive, backward-compatible).

**Why blocking:** P6-02D cannot design the persistence schema or the feature engine without knowing where version metadata lives.

---

### 3.2 PD-7 — Pipeline Strategy

**Question:** Should P6-02 adapt the existing feature engine or build a new P6-native pipeline alongside it?

**Code Evidence:**

| Artifact | Evidence |
|---|---|
| Feature engine location | `src/lib/features/engine.ts` — monolithic `runFeatureEngine()` function |
| Feature engine input | Reads from `market_price_daily` (legacy DB table), NOT P6 observations |
| Feature engine coupling | Tightly coupled to `/api/refresh` route (lines 510–750) |
| P6 quality hook | `src/lib/p6/ingestion/kline-quality-hook.ts` — new P6 module, parallel to legacy |
| Quality/feature gap | Quality path and feature path are "completely parallel and non-intersecting" (P6-02A §3.2) |

**Options Analysis:**

| Option | Pros | Cons | Risk |
|---|---|---|---|
| A: Adapt existing engine | Reuse existing code; less new code | Entangled with legacy DB reads; hard to add quality/freshness gating | High coupling |
| B: Build new alongside | Clean P6 boundary; independent testing; legacy serves P4/P5 until switchover | More code; temporary duplication | Migration complexity |
| C: Gradual migration | Incremental; lower risk per step | Hardest to maintain two paths; highest long-term cost | Complexity |

**PROPOSED RESOLUTION:**

> **Option B (build new alongside)** — The existing feature engine reads from `market_price_daily` and has zero quality/freshness awareness. Adapting it (Option A) would require rewriting its input layer anyway. Building a new P6-native module:
> - Reads from canonical P6 observations (via quality-aware input layer)
> - Applies quality gating and freshness weighting at the observation boundary
> - Produces identical output shape for P4/P5 consumers
> - Existing engine continues to serve P4/P5 until switchover
>
> The legacy engine remains untouched. P6-02D creates `src/lib/p6/feature/` as the new feature engine home.

**Why blocking:** P6-02D cannot begin implementation without knowing whether to modify existing files or create new ones.

---

### 3.3 PD-1 / PD-C4 — Confidence Formula

**Question:** How should confidence incorporate quality metadata alongside source availability?

**Code Evidence:**

| Artifact | Evidence |
|---|---|
| Current confidence | `src/lib/features/confidence.ts` — source-availability-only boolean weighting |
| Default weights | `{ binance_spot: 0.40, binance_futures: 0.40, coingecko: 0.20 }` (from `rule_versions` seed) |
| P6 quality types | `QualityState: VALID \| INVALID \| MISSING \| UNKNOWN` (P6-01D frozen) |
| P6 freshness types | `FreshnessState: FRESH \| STALE \| UNKNOWN` (P6-01C frozen) |

**Options Analysis:**

| Option | Formula | Pros | Cons |
|---|---|---|---|
| A: Source-only (V1) | `confidence = Σ(source_weight × available)` | Preserves current behavior; simplest | Ignores quality entirely |
| B: Quality-adjusted | `confidence = Σ(source_weight × available × quality_ratio)` | Meaningful improvement; uses P6 quality data | Requires quality data per source |
| C: Per-metric weighted | Each metric has independent quality contribution | Most granular | Most complex; requires per-metric quality aggregation |

**PROPOSED RESOLUTION:**

> **Option B (quality-adjusted)** — For each source:
> ```
> quality_ratio = count(VALID observations) / count(total observations for this source)
> source_indicator = source_available × quality_ratio
> confidence = Σ(source_weight × source_indicator) / Σ(source_weight)
> ```
> This preserves the existing source-weight structure while incorporating P6 quality data. Simple, deterministic, and backward-compatible (source-only reduces to source_available when quality data is absent).

**Why blocking:** P6-02D cannot implement the confidence module without the formula.

---

## 4. Non-Blocking Decision Defaults

These decisions have safe defaults that allow P6-02D to proceed. The Planner may override later.

| ID | Question | Default | Rationale |
|---|---|---|---|
| PD-5 | Health dimension weights | Equal (25% each) | Preserves backward compat; configurable per version |
| PD-C2 | HEALTH with 1 dimension | Always compute | Preserves existing behavior |
| PD-2 / PD-C1 | Minimum data threshold | No threshold | Preserves existing behavior |
| PD-3 / PD-6 / PD-C5 | STALE weight multiplier | 1.0 (no weighting V1) | Defers complexity; freshness not consumed today |
| PD-6b | Multi-source priority | No priority V1 | Multiple sources contribute independently |
| PD-C3 | Narrative health method | Market-cap weighted | Preserves current behavior |
| PD-C6 | Min dimension count for HEALTH | No minimum | Preserves backward compat |

---

## 5. Dependency Graph

```
PD-4 (version storage)
    └── blocks P6-02D schema design

PD-7 (pipeline strategy)
    └── blocks P6-02D module architecture

PD-1 / PD-C4 (confidence formula)
    └── blocks P6-02D confidence implementation
        └── PD-1 depends on PD-7 (need to know where confidence lives)

PD-5 (health weights)
    └── PD-C2 (1-dimension health) depends on PD-5
    └── PD-C6 (min dimension count) depends on PD-2 + PD-5
    └── blocks P6-02D health aggregation (default: equal, safe to proceed)

PD-2 / PD-C1 (threshold)
    └── PD-C6 depends on PD-2
    └── blocks P6-02D feature gating (default: no threshold, safe to proceed)

PD-3 / PD-6 / PD-C5 (STALE weight)
    └── blocks P6-02D freshness integration (default: no weighting V1, safe to proceed)

PD-C3 (narrative health)
    └── depends on PD-5, PD-7
    └── blocks P6-02E narrative health (default: market-cap, safe to proceed)
```

### Critical Path

```
PD-4 ──→ P6-02D schema design
PD-7 ──→ P6-02D module architecture ──→ PD-1/PD-C4 ──→ P6-02D confidence impl
```

PD-4 and PD-7 are independent of each other but both must be resolved before P6-02D. PD-1 depends on PD-7 (must know where confidence lives).

---

## 6. Evidence Matrix

| Decision | CODE EVIDENCE | DOCUMENTED REQUIREMENT | PROPOSED RESOLUTION | EVIDENCE GAP |
|---|---|---|---|---|
| PD-4 | `feature_versions` has opaque JSONB `algorithm` column | P6-02B §8: structured version tuple required | Option B: new `p6_feature_versions` table | E-6: exact `algorithm` JSONB shape |
| PD-7 | Feature engine reads `market_price_daily`; monolithic | P6-02A G-1, G-6: engine must read P6 observations | Option B: build new alongside | E-4: production coin count for parallel pipeline perf |
| PD-1 | Current: source-availability-only booleans | P6-02B §5.4: confidence MUST incorporate quality | Option B: quality-adjusted | E-2: P4 explanation engine exact confidence dependency |
| PD-5 | Default weights: `{trend:0.35, derivative:0.35, volume:0.20, momentum:0.10}` in `rule_versions` | P6-02B §9: weight distribution required | Equal (25% each) as V1 default | E-7: `scoreConfigs` current values |
| PD-2 | Current: no threshold behavior | P6-02B §5.5: threshold decision required | No threshold (preserve behavior) | E-5: API consumers depending on data_completeness |
| PD-3 | Current: freshness not consumed at all | P6-02C §5.2: STALE weight required | No weighting V1 (defer) | None — cleanly deferrable |
| PD-6b | Current: no source priority logic | P6-01C: source priority out-of-scope | No priority V1 | None — cleanly deferrable |
| PD-C3 | Current: `calculateWeightedNarrativeHealth()` in `src/lib/scoring/narrative-health.ts` | P6-03A: narrative health location required | P6-02 module | None — default safe |
| PD-C6 | No existing dimension-count check | P6-02C §15: min dimension count | No minimum | None — default safe |

---

## 7. Unresolved Items Summary

### Must resolve before P6-02D (BLOCKING):

| # | Decision | Proposed | Planner Action |
|---|---|---|---|
| 1 | PD-4: Version storage | New `p6_feature_versions` table | APPROVE or select alternative |
| 2 | PD-7: Pipeline strategy | Build new alongside | APPROVE or select alternative |
| 3 | PD-1/PD-C4: Confidence formula | Quality-adjusted (Option B) | APPROVE or select alternative |

### Can defer to P6-02D or later (NON-BLOCKING):

| # | Decision | Default | Override window |
|---|---|---|---|
| 4 | PD-5: Health weights | Equal (25%) | P6-02D implementation |
| 5 | PD-2/PD-C1: Min threshold | No threshold | P6-02D implementation |
| 6 | PD-3/PD-6/PD-C5: STALE weight | No weighting V1 | P6-02E or later |
| 7 | PD-6b: Source priority | No priority V1 | P6-02E or later |
| 8 | PD-C3: Narrative health | Market-cap weighted | P6-02E |
| 9 | PD-C6: Min dimension count | No minimum | P6-02D implementation |

---

## 8. Implementation Readiness Checklist for P6-02D

| # | Item | Status | Blocking? |
|---|---|---|---|
| 1 | P6-02B contract frozen | ✅ YES | Required |
| 2 | P6-02C contract frozen | ✅ YES | Required |
| 3 | QualityState vocabulary frozen | ✅ YES (P6-01D) | Required |
| 4 | FreshnessState vocabulary frozen | ✅ YES (P6-01C) | Required |
| 5 | V1 feature vocabulary defined | ✅ YES (6 features) | Required |
| 6 | Health dimensions defined | ✅ YES (4 dimensions) | Required |
| 7 | Quality gate rules defined | ✅ YES (P6-02B §5, P6-02C §6) | Required |
| 8 | Aggregation rules defined | ✅ YES (P6-02C §4–9) | Required |
| 9 | Provenance model defined | ✅ YES (P6-02B §7, P6-02C §11) | Required |
| 10 | Determinism requirements defined | ✅ YES (P6-02C §9) | Required |
| 11 | Rounding rules defined | ✅ YES (P6-02C §12) | Required |
| 12 | Version tuple storage (PD-4) | ⏳ **PENDING** | **YES — BLOCKING** |
| 13 | Pipeline strategy (PD-7) | ⏳ **PENDING** | **YES — BLOCKING** |
| 14 | Confidence formula (PD-1/PD-C4) | ⏳ **PENDING** | **YES — BLOCKING** |
| 15 | Health weights (PD-5) | ⏳ PENDING (default: equal) | No — default safe |
| 16 | Min threshold (PD-2/PD-C1) | ⏳ PENDING (default: none) | No — default safe |
| 17 | STALE weight (PD-3/PD-6/PD-C5) | ⏳ PENDING (default: no weighting) | No — default safe |
| 18 | Multi-source priority (PD-6b) | ⏳ PENDING (default: none) | No — default safe |
| 19 | Narrative health method (PD-C3) | ⏳ PENDING (default: mcap-weighted) | No — default safe |
| 20 | Min dimension count (PD-C6) | ⏳ PENDING (default: none) | No — default safe |
| 21 | P4/P5 backward compat verified | ⚠️ PARTIAL | Recommended |
| 22 | Evidence gap E-6 resolved | ⏳ PENDING | Recommended for PD-4 |

### Readiness Verdict

**P6-02D is BLOCKED on 3 decisions:** PD-4, PD-7, PD-1/PD-C4.

Once these 3 are resolved by the Planner, P6-02D can proceed. The remaining 6 decisions have safe defaults and can be resolved during or after P6-02D implementation.

---

## 9. Acceptance Checklist

- [x] Master decision matrix complete (14 decisions)
- [x] Blocking decisions identified (3)
- [x] Non-blocking decisions identified (9 with safe defaults)
- [x] Dependency graph produced
- [x] Evidence matrix with code evidence, documented requirements, proposed resolutions
- [x] Proposed resolutions for all blocking decisions
- [x] Unresolved items explicitly listed
- [x] Implementation readiness checklist for P6-02D (22 items)
- [x] No production code modified
- [x] No schema/migration changes
- [x] No P6-01 contract modifications
- [x] No P3/P4/P5 modifications
- [x] No semantic decisions made by agent (all resolutions are PROPOSED)
