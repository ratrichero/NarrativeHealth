# P6-02A — Derived Feature Landscape Recon

**Date:** 2026-08-26
**Task Type:** RECON ONLY — no implementation, no schema changes, no semantic decisions.
**Authority:** P6-01-FINAL (`8a1db6e`), P6-01B observation contract, P6-01C source/freshness contracts, P6-01D quality contracts.

---

## 1. Executive Summary

The current Derived Feature layer consists of four score dimensions (trend, derivative, volume, momentum), a health score aggregator, a recommendation signal generator, and a set of technical indicators. These are computed inside the production refresh pipeline and consumed by P4/P5 API routes.

**Key findings:**

1. The current feature engine is a **legacy P4-era implementation** that pre-dates P6. It reads from `market_price_daily` (legacy table) rather than canonical P6 observations. It does NOT consume P6 quality or freshness signals.
2. **No P6 canonical observation consumption** exists in the feature pipeline. The feature engine reads raw DB rows from `market_price_daily`, not from P6 observation infrastructure.
3. **Provenance is partially recorded** (source-level flags in `sourceProvenance` JSONB) but lacks P6-01B-level precision (no `observed_at`, no `quality_status`, no `freshness_status` per input).
4. **Versioning exists** (`feature_versions` table, `versionId` FK) but algorithm parameters are stored as opaque JSONB, not as structured, queryable version tuples.
5. **No quality/freshness gating** — feature calculations proceed regardless of observation quality or freshness state.
6. **P6-02 must build a new feature layer** that consumes canonical P6 observations with quality/freshness awareness, rather than adapting the legacy engine.

---

## 2. Inventory

### 2.1 Database Tables

| Table | Columns (key) | Purpose | Consumers |
|---|---|---|---|
| `features` | coinId, date, versionId, trendScore, derivativeScore, volumeScore, momentumScore, trendDetail, derivativeDetail, volumeDetail, momentumDetail, confidenceScore, dataCompleteness, missingSources, sourceProvenance, calculatedAt | Primary feature storage | `/api/coins/[id]`, `/api/narratives/[id]`, `/api/refresh/*` |
| `feature_versions` | id, version, description, algorithm (JSONB), isActive | Version tracking | `features.versionId` FK |
| `health_scores` | coinId, date, healthScore, previousScore, scoreChange, status, confidenceScore, weightBreakdown, ruleVersionId | Aggregated health | `/api/coins/[id]`, `/api/dashboard`, `/api/refresh/*` |
| `recommendations` | coinId, date, signal, reason, reasonBreakdown, healthScoreId, ruleVersionId | Decision support signal | `/api/coins/[id]`, `/api/dashboard`, `/api/narratives/[id]` |
| `indicators` | coinId, date, timeframe, indicatorType, indicatorValue, indicatorMeta, source, calculatedAt | Technical indicators (EMA, RSI, MACD, etc.) | `indicatorService` |
| `scoreConfigs` | configType, configKey, configValue, version, isActive | Weight/threshold configuration | `refresh/route.ts` (healthWeights, confidenceWeights, thresholds) |
| `ruleVersions` | version, description, healthWeights, confidenceWeights, thresholds | Rule version bundle | `ruleEngineService`, `healthScores`, `recommendations` |
| `recommendationRules` | ruleVersionId, priority, signal, logicOperator, conditions, reasonTemplate | Rule definitions | `ruleEngineService` |
| `narrativeHealth` | narrativeId, date, healthScore, previousScore, scoreChange, status, coinCount, topCoinId, weakestCoinId, avgConfidence, coinBreakdown, ruleVersionId, weightingMethod, weightDetails | Narrative-level aggregation | `/api/narratives/[id]` |

### 2.2 Calculation Modules

| Module | File | Inputs | Outputs | Notes |
|---|---|---|---|---|
| Trend Score | `src/lib/features/trend.ts` | `closes[]` (from market_price_daily) | `{ score, detail: { ema20/50/200, price_vs_ema*, ema*_vs_ema* } }` | Pure function; EMA-based |
| Derivative Score | `src/lib/features/derivative.ts` | `oiCurrent, oiPrev, fundingRate, hasFutures` | `{ score, detail: { oi_change_pct, funding_rate, accumulation_bonus } }` | Pure function; OI+FR based |
| Volume Score | `src/lib/features/volume.ts` | `volumes[]` (from market_price_daily) | `{ score, detail: { volume_current, volume_ma20, volume_ratio } }` | Pure function; MA20-based |
| Momentum Score | `src/lib/features/momentum.ts` | `closes[], highs[], lows[]` | `{ score, detail: { roc_14, atr_14, atr_pct } }` | Pure function; ROC+ATR based |
| Confidence | `src/lib/features/confidence.ts` | `binanceSpotOk, binanceFuturesOk, coingeckoOk, hasFutures, weights` | `{ confidence_score, missing_sources, data_completeness }` | Source-availability based |
| Feature Engine | `src/lib/features/engine.ts` | `PriceData[], metrics, healthWeights, confidenceWeights, sourceOk` | `FeatureEngineResult` (all 4 scores + details + confidence) | Orchestrator |
| Health Score | `src/lib/features/engine.ts` (inline) | `trendScore, derivativeScore, volumeScore, momentumScore, weights` | `number` (0-100) | Weighted sum |
| Recommendation | `src/lib/features/engine.ts` (inline) | `healthScore, thresholds` | `STRONG_WATCH / WATCH / OBSERVE / WEAK` | Threshold-based |
| Indicators | `src/lib/indicators/engine.ts` | `KlineData[], timeframe` | `CalculatedIndicator[]` (EMA_9/21/50/200, RSI_14, MACD, ADX_14, BB_20, ATR_14, VWAP_20, VOLUME_RATIO, OBV) | 12 indicator types |
| Narrative Health | `src/lib/scoring/narrative-health.ts` | `coinScores[], ruleVersionId, previousScore` | `NarrativeHealthEnhanced` | Weighted aggregation |
| Rule Engine | `src/lib/services/rule-engine.service.ts` | `ScoreInput, versionId` | `RecommendationResult` (signal, reason, ruleId) | DB-driven rules |

---

## 3. Data Flow Trace

### 3.1 Current Production Pipeline (per coin, in `/api/refresh`)

```
External Source (Binance/CoinGecko)
    ↓ collector functions
Raw Payload (KlineData[], FuturesMetrics, CoinGeckoMetrics)
    ↓ market_price_daily upsert (per kline row)
    ↓ coin_metrics upsert (OI, FR, FDV)
    ↓
[Legacy DB Tables]
    ↓ db.select from market_price_daily (read all rows for coin)
    ↓
Feature Engine (runFeatureEngine)
    ├── trendScore ← closes[] ← market_price_daily.close
    ├── volumeScore ← volumes[] ← market_price_daily.volume
    ├── momentumScore ← closes[], highs[], lows[] ← market_price_daily.*
    ├── derivativeScore ← oiCurrent, oiPrev, fundingRate ← coin_metrics
    └── confidenceScore ← sourceOk flags
    ↓
Health Score (calculateHealthScore) ← 4 feature scores + weights
    ↓
Recommendation (ruleEngineService.evaluate) ← health + 4 feature scores + confidence
    ↓
narrative_health (calculateWeightedNarrativeHealth) ← coin health scores + weights
    ↓
P4/P5 Consumers (API routes, dashboard, narratives)
```

### 3.2 P6 Quality Hook (parallel path, not consumed by features)

```
Raw KlineData
    ↓ evaluateKlineObservationQuality (P6-01E-C hook)
    ↓ D2 validation → D3 persistence → p6_observation_quality
    ↓
[P6 Quality Table] ← NOT consumed by feature engine
```

**Critical observation:** The P6 quality path and the legacy feature path are currently **completely parallel and non-intersecting**. The feature engine reads from `market_price_daily` (legacy) while quality is written to `p6_observation_quality` (P6). No consumer bridges them.

---

## 4. Feature Classification

### 4.1 Reusable (P6-02 can consume directly)

| Feature | Why reusable | Adaptation needed |
|---|---|---|
| Trend Score calculation (EMA-based) | Pure function over `closes[]`; algorithm is sound | Input source must change from legacy DB read to canonical observation read |
| Volume Score calculation (MA20-based) | Pure function over `volumes[]`; algorithm is sound | Input source must change |
| Momentum Score calculation (ROC+ATR) | Pure function over `closes[], highs[], lows[]`; algorithm is sound | Input source must change |
| Derivative Score calculation (OI+FR) | Pure function over snapshot metrics; algorithm is sound | Input source must change; OI/FR not yet wired to P6 quality |
| Confidence calculation (source-availability) | Pure function over boolean flags | Must be extended to incorporate P6 quality signals |
| Technical indicators (EMA, RSI, MACD, etc.) | Pure functions over kline arrays; 12 types defined | Already computed from raw klines; can be reused |
| Health Score (weighted sum) | Simple aggregation; algorithm is sound | Weights must be configurable per P6-02B |
| Recommendation (threshold-based) | Simple threshold; algorithm is sound | Thresholds must be configurable per P6-02B |

### 4.2 Needs Adaptation

| Feature | What needs changing | Why |
|---|---|---|
| Feature Engine orchestrator | Must read from canonical P6 observations instead of `market_price_daily` | P6-02 requires quality-aware input |
| Provenance model | Must include `observed_at`, `quality_status`, `freshness_status` per input | Current provenance is source-flag-only |
| Confidence calculation | Must incorporate P6 quality states (e.g., INVALID → reduced confidence) | Current implementation only uses source-availability booleans |
| Feature versioning | Algorithm parameters must be structured, not opaque JSONB | P6 requires deterministic reproducibility |
| Health Score weights | Must be versioned alongside algorithm | Currently stored in `scoreConfigs` but not tightly coupled to algorithm version |

### 4.3 Incompatible (must be replaced or redesigned)

| Feature | Why incompatible | P6-02 replacement |
|---|---|---|
| Feature pipeline as monolithic refresh step | Tightly coupled to `/api/refresh` route; cannot be invoked independently | Must become a standalone, testable module |
| `sourceProvenance` JSONB structure | Ad-hoc; no observed_at, no quality/freshness per input | Must follow P6-01B provenance model |
| `missingSources` array | Based on collector success flags, not P6 quality states | Must be replaced by quality-aware completeness |
| `dataCompleteness` score | Derived from source-availability booleans, not quality evaluation | Must incorporate quality states |

### 4.4 Missing (not yet implemented)

| Capability | Why needed | P6 dependency |
|---|---|---|
| Quality-aware feature input | Feature engine must know observation quality to gate/hedge calculations | P6-01D (quality) |
| Freshness-aware feature input | Feature engine must know observation freshness to weight recency | P6-01C (freshness) |
| Deterministic version tuples | Algorithm + parameters + schema must be a queryable, immutable record | P6-02D requirement |
| Dimension decomposition | Health score must be decomposable into named dimensions with clear definitions | P6-02B requirement |
| Narrative health as P6 derived output | Currently computed in refresh route; must become a P6-02 module | P6-02E requirement |

---

## 5. Provenance Audit

### 5.1 Current Provenance Model

The `sourceProvenance` JSONB in `features` table:

```json
{
  "trend": {
    "sources": ["binance_spot", "binance_futures"],
    "indicators": ["EMA_9", "EMA_21", "EMA_50", "EMA_200", "ADX_14"],
    "calculated_at": "2026-08-26T...",
    "confidence": 85
  },
  "derivative": { ... },
  "volume": { ... },
  "momentum": { ... }
}
```

### 5.2 Gaps

| Gap | Severity | P6-02 requirement |
|---|---|---|
| No `observed_at` per input observation | HIGH | P6-01B requires observation identity; provenance must trace to specific observations |
| No `quality_status` per input | HIGH | P6-01D requires quality metadata; feature engine must know input quality |
| No `freshness_status` per input | MEDIUM | P6-01C requires freshness metadata; feature engine should weight by freshness |
| No `algorithm_version` in provenance | HIGH | P6 requires deterministic reproducibility; provenance must include version tuple |
| No `input_observation_ids` | HIGH | P6-01B defines observation_id; provenance must reference specific input observations |
| `calculated_at` is wall-clock, not versioned | LOW | Version tuple should include calculation timestamp |
| `sources` are boolean flags, not observation references | MEDIUM | Must reference actual observations, not source-availability flags |

---

## 6. Versioning Audit

### 6.1 Current Versioning

| Mechanism | Implementation | Gaps |
|---|---|---|
| `feature_versions` table | `id, version (integer), description, algorithm (JSONB), isActive` | Algorithm stored as opaque JSONB; no structured parameter record |
| `scoreConfigs` table | `configType, configKey, configValue, version` | Loose coupling; not tied to feature version |
| `ruleVersions` table | `version, healthWeights, confidenceWeights, thresholds` | Bundles weights with rules; not independently versioned |
| `recommendationRules` | `ruleVersionId, conditions, signal` | Versioned via ruleVersion |

### 6.2 Gaps

| Gap | Severity | P6-02 requirement |
|---|---|---|
| Algorithm parameters in opaque JSONB | HIGH | Must be structured and queryable for reproducibility |
| No input schema version | HIGH | Feature engine must declare what input shape it expects |
| No output schema version | MEDIUM | Feature output must be versioned independently |
| No version tuple (algorithm + params + schema) | HIGH | P6 requires `(algorithm_version, parameter_version, schema_version)` |
| Weight config loosely coupled | MEDIUM | Weights must be part of the version tuple |

---

## 7. Temporal Audit

### 7.1 Current Temporal Behavior

| Aspect | Implementation | Gaps |
|---|---|---|
| `calculated_at` in features | `new Date()` at calculation time | Wall-clock; not tied to input observation timestamps |
| `calculated_at` in indicators | `NOW()` in DB insert | Same |
| `date` in features | `getBusinessDate()` (Asia/Ho_Chi_Minh timezone) | Business date, not observation time |
| Input window | 200 daily klines from `market_price_daily` | No freshness awareness; reads all available rows |
| Recalculation | Every refresh overwrites with `onConflictDoUpdate` | No historical versioning of calculations |

### 7.2 Gaps

| Gap | Severity | P6-02 requirement |
|---|---|---|
| No input observation timestamp tracking | HIGH | Must record which `observed_at` values were used as inputs |
| No freshness-weighted recalculation | MEDIUM | Should weight inputs by freshness (FRESH > STALE > UNKNOWN) |
| No quality-gated recalculation | HIGH | Should skip or hedge calculations when inputs are INVALID |
| Business date ≠ observation time | LOW | Feature output `date` is business date; input `observed_at` is source time — both valid but must be explicit |

---

## 8. Quality/Freshness Interaction

### 8.1 Current State

The feature engine has **zero interaction** with P6 quality or freshness:

- No import from `src/lib/p6/quality/`
- No import from `src/lib/p6/freshness/`
- No reference to `quality_status` or `freshness_status`
- Feature calculations proceed regardless of observation quality
- Feature calculations proceed regardless of observation freshness

### 8.2 Required Interaction (P6-02)

| Interaction | Why | Implementation approach |
|---|---|---|
| Quality gating | INVALID observations should not pollute feature calculations | Feature engine must check `quality_status` per input before including it |
| Freshness weighting | STALE observations should be weighted less than FRESH | Feature engine must incorporate `freshness_status` into scoring |
| Confidence adjustment | Quality states should inform confidence | Confidence calculation must incorporate quality metadata |
| MISSING handling | MISSING observations should reduce data_completeness | Already partially handled by `missingSources`; must align with P6 MISSING state |

### 8.3 Boundary

P6-02 must NOT:
- Convert quality states into feature scores (quality ≠ feature)
- Convert freshness states into quality states (dimensions are independent)
- Auto-correct observations based on quality (no auto-correction per P6-01D)

---

## 9. P4/P5 Compatibility

### 9.1 Current P4/P5 Consumers

| Consumer | Reads | How |
|---|---|---|
| `/api/coins/[id]` | `features`, `health_scores`, `recommendations` | Direct DB queries |
| `/api/coins/[id]/decision` | `health_scores` | Direct DB query |
| `/api/narratives/[id]` | `features`, `health_scores`, `recommendations`, `narrative_health` | Direct DB queries |
| `/api/dashboard` | `health_scores`, `recommendations` | Direct DB queries |
| P4 explanation engine | Indirectly via feature data | `src/lib/p4/explanation/engine.ts` |
| P5 rule engine | `recommendationRules`, `ruleVersions` | `src/lib/services/rule-engine.service.ts` |

### 9.2 Compatibility Assessment

| Check | Result | Note |
|---|---|---|
| P4/P5 contracts modified by P6-01 | NO | P6-01 only added quality/freshness infrastructure |
| Feature table schema unchanged | YES | `features` table schema is legacy; P6-02 must not break existing reads |
| Health scores schema unchanged | YES | `health_scores` table is legacy; P6-02 must not break existing reads |
| Recommendations schema unchanged | YES | `recommendations` table is legacy; P6-02 must not break existing reads |
| P4 explanation engine | Untouched by P6-01 | Reads feature data; must continue to work |
| P5 rule engine | Untouched by P6-01 | Evaluates rules against scores; must continue to work |

**P6-02 strategy:** P6-02 should produce feature outputs that are compatible with existing P4/P5 consumers. The `features` table schema may need extension (new columns for quality/freshness metadata) but existing columns must remain readable by P4/P5.

---

## 10. Gaps Summary

### 10.1 Critical Gaps (must be resolved before P6-02 implementation)

| # | Gap | Impact | Category |
|---|---|---|---|
| G-1 | Feature engine reads from legacy `market_price_daily`, not P6 canonical observations | Cannot consume quality/freshness | Architecture |
| G-2 | No quality-aware input to feature calculations | Features may be computed from INVALID data | Semantic |
| G-3 | No freshness-aware input to feature calculations | Features may be computed from STALE data | Semantic |
| G-4 | No structured version tuple (algorithm + params + schema) | Cannot guarantee reproducibility | Versioning |
| G-5 | Provenance lacks `observed_at`, `quality_status`, `freshness_status` per input | Cannot trace derivation to specific observations | Provenance |

### 10.2 Important Gaps (should be resolved in P6-02)

| # | Gap | Impact | Category |
|---|---|---|---|
| G-6 | Feature engine is monolithic (embedded in refresh route) | Cannot be tested independently | Architecture |
| G-7 | Health score is a simple weighted sum with no decomposition | P6-02B requires dimension decomposition | Semantic |
| G-8 | Confidence is source-availability-only | Must incorporate quality metadata | Semantic |
| G-9 | `dataCompleteness` is source-flag-based | Must align with P6 quality states | Semantic |
| G-10 | Narrative health is computed in refresh route | Must become a P6-02 module | Architecture |

### 10.3 Nice-to-Have Gaps (defer to later P6)

| # | Gap | Impact | Category |
|---|---|---|---|
| G-11 | No historical feature versioning (latest-only) | Cannot compare across algorithm versions | Versioning |
| G-12 | No feature output schema validation | Outputs could drift silently | Quality |
| G-13 | Indicator calculations not integrated with P6 quality | Indicators may use INVALID data | Quality |

---

## 11. Candidate Decisions for P6-02B

| # | Decision | Options | Dependency |
|---|---|---|---|
| CD-1 | Feature input source: legacy DB or P6 canonical observations? | A: Read from `market_price_daily` + quality join; B: Read from new P6 observation table | G-1 |
| CD-2 | Quality gating: skip, hedge, or pass-through? | A: Skip INVALID inputs; B: Hedge with reduced confidence; C: Pass-through with quality metadata | G-2 |
| CD-3 | Freshness weighting: how to weight FRESH vs STALE? | A: Binary (FRESH=1, else=0.5); B: Linear decay; C: Configurable per dimension | G-3 |
| CD-4 | Version tuple structure | A: `(algorithm_version, parameter_version, schema_version)`; B: Single version integer | G-4 |
| CD-5 | Health score decomposition: weighted sum, worst-case, or hybrid? | A: Weighted sum (current); B: Worst-case floor; C: Hybrid with floor | G-7 |
| CD-6 | Confidence model: extend current or redesign? | A: Extend source-availability with quality; B: Redesign as quality×freshness composite | G-8 |

---

## 12. Evidence Gaps

| # | Gap | Why needed | How to resolve |
|---|---|---|---|
| E-1 | Production `features` table row count and distribution | Understand data volume for migration | Production DB query |
| E-2 | P4 explanation engine's exact dependency on feature fields | Ensure backward compatibility | P4 code audit |
| E-3 | P5 rule engine's exact dependency on score fields | Ensure backward compatibility | P5 code audit |
| E-4 | Actual production coin count and refresh frequency | Performance planning | Production monitoring |
| E-5 | Whether any external consumer reads feature data via API | API contract stability | API audit |

---

## 13. Proposed Next Task Graph

```text
P6-02A (this recon) ──────────────────────────────────────→
        │
        ├──────────────────────────────────────────────────→ P6-02B (Health Dimension Definitions)
        │                                                       │
        │                                                       ├→ P6-02C (Aggregation Contract)
        │                                                       │       │
        │                                                       │       └→ P6-02D (Algorithm V1)
        │                                                       │               │
        │                                                       │               └→ P6-02E (Snapshot Persistence)
        │                                                       │                       │
        │                                                       │                       └→ P6-02F (Tests)
        │                                                       │                               │
        │                                                       │                               └→ P6-02-FINAL
        │                                                       │
        │                                                       └→ [parallel with P6-03B]
        │
        └→ P6-03A (Membership Recon) ──→ P6-03B ──→ P6-03C ──→ P6-03D ──→ P6-03E ──→ P6-03-FINAL
```

**P6-02B is the immediate next task.** It depends on this recon and must resolve CD-1 through CD-6 before P6-02C/D/E can proceed.

---

## 14. Acceptance Checklist

- [x] All feature tables inventoried
- [x] All calculation modules traced
- [x] Full data flow mapped (source → feature → consumer)
- [x] Features classified (reusable / adaptation / incompatible / missing)
- [x] Provenance gaps identified
- [x] Versioning gaps identified
- [x] Temporal gaps identified
- [x] Quality/freshness interaction documented
- [x] P4/P5 compatibility assessed
- [x] Gaps classified by severity
- [x] Candidate decisions identified for P6-02B
- [x] Evidence gaps documented
- [x] Next task graph proposed
- [x] No production code modified
- [x] No schema changes
- [x] No semantic decisions made
