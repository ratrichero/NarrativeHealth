# P6-03A — Intelligence / Snapshot Landscape Recon

**Date:** 2026-08-26
**Task Type:** RECON ONLY — no implementation, no schema changes, no semantic decisions.
**Authority:** P6-01-FINAL (`8a1db6e`), P6-02A recon (`3ed1714`), P4-P5 Handoff (`P4-P5_HANDOFF.md`).

---

## 1. Executive Summary

The current Intelligence / Snapshot layer is a **legacy P3/P4-era implementation** that pre-dates P6. It consists of:

- **Feature scores** (trend, derivative, volume, momentum) computed from `market_price_daily`
- **Health scores** (weighted aggregation of feature scores)
- **Recommendations** (threshold-based signals from health scores)
- **Narrative health** (weighted aggregation of coin health scores)
- **Morning snapshots** (daily point-in-time captures of all coin/narrative health)
- **P4 interpretation** (explanation engine with evidence references)
- **P5 decision support** (policy evaluation, safety, approval, recording, replay)

**Key findings:**

1. The intelligence layer is **completely legacy** — it reads from `market_price_daily` and `coin_metrics` (P3 tables), NOT from P6 canonical observations. P6 quality/freshness signals are not consumed.
2. **P4/P5 contracts are frozen and must not be modified.** P6 must produce intelligence outputs that are compatible with existing P4/P5 consumers without changing P4/P5 semantics.
3. **Snapshot identity is date-based** (`date` column in `morning_snapshot_headers`), not observation-identity-based. Snapshots capture a daily summary, not a derivation trace.
4. **No algorithm/config versioning** in snapshot outputs — `ruleVersionId` is recorded but algorithm parameters are not embedded.
5. **No reproducibility guarantee** — snapshots are computed from live DB state at snapshot time; there is no mechanism to reconstruct a historical snapshot from recorded inputs.
6. **P5 historical integrity is a hard boundary** — P5-07 replay reads from persisted artifacts, never re-computes from live data. P6 must not break this.

---

## 2. Inventory

### 2.1 Intelligence Tables

| Table | Purpose | Key Columns | Consumers |
|---|---|---|---|
| `features` | Per-coin feature scores | coinId, date, versionId, trendScore, derivativeScore, volumeScore, momentumScore, confidenceScore, dataCompleteness, sourceProvenance | `/api/coins/[id]`, `/api/narratives/[id]` |
| `health_scores` | Per-coin health aggregation | coinId, date, healthScore, previousScore, scoreChange, status, confidenceScore, weightBreakdown | `/api/coins/[id]`, `/api/dashboard`, P4 interpretation |
| `recommendations` | Per-coin decision signal | coinId, date, signal, reason, reasonBreakdown, ruleVersionId | `/api/coins/[id]`, `/api/dashboard`, `/api/narratives/[id]` |
| `narrative_health` | Per-narrative health aggregation | narrativeId, date, healthScore, coinCount, topCoinId, weakestCoinId, coinBreakdown, weightingMethod, weightDetails | `/api/narratives/[id]` |
| `indicators` | Technical indicators (EMA, RSI, MACD, etc.) | coinId, date, timeframe, indicatorType, indicatorValue, indicatorMeta | `indicatorService`, API routes |
| `feature_versions` | Feature algorithm versioning | id, version, description, algorithm (JSONB) | `features.versionId` FK |
| `score_configs` | Weight/threshold configuration | configType, configKey, configValue, version | `refresh/route.ts` |
| `rule_versions` | Rule version bundle | version, healthWeights, confidenceWeights, thresholds | `ruleEngineService`, `healthScores` |
| `recommendation_rules` | Rule definitions | ruleVersionId, priority, signal, conditions | `ruleEngineService` |

### 2.2 Snapshot Tables

| Table | Purpose | Identity | Consumers |
|---|---|---|---|
| `morning_snapshot_headers` | Daily snapshot summary | `date` (unique) | `snapshotService`, `/api/dashboard` |
| `morning_snapshot_coins` | Per-coin snapshot | `(snapshotId, coinId)` | `snapshotService.getSnapshotByDate` |
| `morning_snapshot_narratives` | Per-narrative snapshot | `(snapshotId, narrativeId)` | `snapshotService.getSnapshotByDate` |
| `narrative_membership_snapshots` | Narrative membership history | `(narrativeId, windowEnd, snapshotRevision, membershipMode)` | P3 membership tracking |
| `narrative_membership_snapshot_members` | Membership detail | `(snapshotId, coinId)` | P3 membership tracking |
| `morning_snapshots` (legacy) | Legacy JSONB snapshot | `date` (unique) | Possibly deprecated |

### 2.3 P4/P5 Intelligence Components

| Component | File | Purpose | P6 boundary |
|---|---|---|---|
| P4 Interpretation | `src/lib/p4/interpretation.ts` | Maps P3 states to P4 direction/qualitative values | FROZEN — must not be modified |
| P4 Explanation Engine | `src/lib/p4/explanation/engine.ts` | Generates explanation items from evidence references | FROZEN — must not be modified |
| P4 Evidence Resolver | `src/lib/p4/explanation/resolver.ts` | Resolves evidence references to human-readable values | FROZEN — must not be modified |
| P4 Assembler | `src/lib/p4/assembler.ts` | Assembles P4 interpretation results | FROZEN — must not be modified |
| P5 Policy Evaluator | `src/lib/p5/policy/evaluator.ts` | Evaluates policy rules against P4 interpretations | FROZEN — must not be modified |
| P5 Safety Evaluator | `src/lib/p5/safety/evaluator.ts` | Evaluates safety guardrails | FROZEN — must not be modified |
| P5 Decision Producer | `src/lib/p5/producer/p5-decision-producer.ts` | Produces P5 decision records | FROZEN — must not be modified |
| P5 Artifact Recorder | `src/lib/p5/record/p5-artifact-recorder.ts` | Records historical artifacts for replay | FROZEN — must not be modified |
| P5 Replay Engine | `src/lib/p5/replay/replay-engine.ts` | Reconstructs historical decisions from artifacts | FROZEN — must not be modified |
| P5 Read Service | `src/lib/p5/read/action-read.service.ts` | Read-only access to P5 decisions | FROZEN — must not be modified |
| Narrative Health | `src/lib/scoring/narrative-health.ts` | Weighted narrative health calculation | P6-02 scope (not frozen) |

---

## 3. Data Flow Trace

### 3.1 Current Production Pipeline

```
External Source (Binance/CoinGecko)
    ↓ collectors
Raw Payload
    ↓ market_price_daily upsert
    ↓ coin_metrics upsert
    ↓
[Legacy P3 Tables]
    ↓ db.select from market_price_daily (read all rows for coin)
    ↓
Feature Engine (runFeatureEngine) → features table
    ↓
Health Score (calculateHealthScore) → health_scores table
    ↓
Recommendation (ruleEngineService.evaluate) → recommendations table
    ↓
Narrative Health (calculateWeightedNarrativeHealth) → narrative_health table
    ↓
Morning Snapshot (snapshotService.createDailySnapshot)
    ├── morning_snapshot_headers
    ├── morning_snapshot_coins
    └── morning_snapshot_narratives
    ↓
P4 Interpretation → P4 Explanation → P5 Policy → P5 Safety → P5 Decision
    ↓
P5 Artifact Recording → PostgreSQL → P5 Replay (historical)
    ↓
API Routes (/api/coins, /api/narratives, /api/dashboard)
    ↓
UI (React components)
```

### 3.2 P6 Quality/Freshness Layer (parallel, not consumed)

```
Raw KlineData
    ↓ P6-01E hook
    ↓ Quality evaluation → p6_observation_quality
    ↓
[P6 Tables] ← NOT consumed by feature/health/recommendation pipeline
```

### 3.3 P6 Observation Identity (parallel, not consumed)

```
Canonical Observation (entity_id, metric, source, observed_at, timeframe)
    ↓ P6-01B identity
    ↓ P6-01C source registry
    ↓ P6-01D quality evaluation
    ↓
[P6 Infrastructure] ← NOT consumed by intelligence pipeline
```

---

## 4. Snapshot Identity Analysis

### 4.1 Current Snapshot Identity

| Snapshot Type | Identity | Temporal Semantics |
|---|---|---|
| Morning Snapshot Header | `date` (unique) | Business date (Asia/Ho_Chi_Minh) |
| Morning Snapshot Coin | `(snapshotId, coinId)` | Per-coin within a daily snapshot |
| Morning Snapshot Narrative | `(snapshotId, narrativeId)` | Per-narrative within a daily snapshot |
| Narrative Membership Snapshot | `(narrativeId, windowEnd, snapshotRevision, membershipMode)` | Window-based with revision tracking |

### 4.2 Gaps

| Gap | Impact | P6 requirement |
|---|---|---|
| No observation-level snapshot identity | Cannot trace snapshot to specific input observations | P6 needs `(entity_id, metric, source, observed_at, timeframe)` reference |
| No algorithm version in snapshot | Cannot determine which algorithm produced a historical snapshot | P6 needs version tuple in snapshot |
| No input observation IDs | Cannot verify which observations were used | P6 needs provenance chain to input observations |
| `date` is business date, not observation time | Snapshot captures daily summary, not observation-time-aligned | Acceptable for daily snapshots; P6-02E must be explicit about temporal semantics |

---

## 5. Provenance Chain Analysis

### 5.1 Current Provenance

| Layer | Provenance | Gaps |
|---|---|---|
| Features | `sourceProvenance` JSONB: `{ sources: [...], indicators: [...], calculated_at, confidence }` | No observed_at, no quality_status, no freshness_status, no input observation IDs |
| Health Scores | `weightBreakdown` JSONB: `{ trend: N, derivative: N, volume: N, momentum: N }` | No algorithm version, no input feature IDs |
| Recommendations | `reasonBreakdown` JSONB: `{ trend, derivative, volume, momentum, ruleId, matched }` | No rule content hash, no snapshot reference |
| Narrative Health | `coinBreakdown` JSONB: `[{ coinId, score, weight }]` | No algorithm version, no input health_score IDs |
| Morning Snapshots | Summary only (totalCoins, avgHealthScore, alertCount) | No derivation trace, no input references |

### 5.2 Required Provenance Chain (P6)

```
Canonical Observation (observed_at, quality_status, freshness_status)
    ↓ quality evaluation
Quality Record (p6_observation_quality)
    ↓ feature calculation
Feature Record (with input_observation_ids, algorithm_version)
    ↓ health aggregation
Health Record (with input_feature_ids, algorithm_version, weights_version)
    ↓ narrative aggregation
Narrative Record (with input_health_ids, algorithm_version, weights_version)
    ↓ snapshot
Snapshot Record (with input_records, algorithm_version, full_provenance)
```

---

## 6. Versioning Model Analysis

### 6.1 Current Versioning

| Mechanism | Implementation | Gaps |
|---|---|---|
| `feature_versions` | Integer version + opaque JSONB algorithm | Not structured; not queryable |
| `rule_versions` | Integer version + weights/thresholds JSONB | Bundles weights with rules |
| `score_configs` | configType/configKey/configValue | Loosely coupled; not tied to algorithm version |
| `recommendation_rules` | ruleVersionId FK | Versioned via rule version |

### 6.2 Required Version Tuple (P6)

P6 requires a structured version tuple for deterministic reproducibility:

```
VersionTuple = {
  algorithm_version: string,     // e.g., "p6-health-v1"
  parameter_version: string,     // e.g., "weights-v1"
  schema_version: string,        // e.g., "features-v2"
  calculation_timestamp: Date,   // when computed
  input_observation_window: {    // what inputs were used
    start: Date,
    end: Date,
    count: number
  }
}
```

### 6.3 Gaps

| Gap | Impact |
|---|---|
| No structured version tuple | Cannot guarantee reproducibility |
| Algorithm parameters in opaque JSONB | Cannot query or compare parameters across versions |
| No input schema version | Feature output shape could drift silently |
| Weight config loosely coupled | Weights may change without algorithm version change |

---

## 7. Reproducibility Analysis

### 7.1 Current State

| Aspect | Reproducible? | Evidence |
|---|---|---|
| Feature calculation | PARTIALLY | Same DB state → same features; but DB state depends on live collector data |
| Health score | PARTIALLY | Same feature scores → same health; but feature scores depend on live DB |
| Recommendation | PARTIALLY | Same scores + same rules → same recommendation; but rules may change |
| Narrative health | PARTIALLY | Same coin scores → same narrative health; but weights may change |
| Morning snapshot | NO | Snapshot is a point-in-time capture; no mechanism to reconstruct from inputs |
| P5 decision | YES | P5-07 replay reconstructs from persisted artifacts (frozen P5 contract) |

### 7.2 Gaps

| Gap | Impact | P6 requirement |
|---|---|---|
| No input observation recording | Cannot reconstruct feature calculation from recorded inputs | Must record input observation IDs |
| No algorithm parameter recording | Cannot verify which parameters produced a result | Must embed parameters in version tuple |
| No snapshot reconstruction mechanism | Historical snapshots cannot be verified | Must support reconstruction from recorded inputs |
| Live DB dependency | Feature calculation depends on current DB state, not recorded inputs | Must read from recorded observations, not live DB |

---

## 8. P4/P5 Boundary Audit

### 8.1 Frozen Contracts (from P4-P5 Handoff)

| Contract | Source | Status |
|---|---|---|
| outcome ≠ safety | P5-02 AD-009 | FROZEN — must not violate |
| outcome ≠ approval | P5-02 AD-009 | FROZEN — must not violate |
| outcome ≠ permission | P5-02 AD-009 | FROZEN — must not violate |
| outcome ≠ execution | P5-02 AD-009 | FROZEN — must not violate |
| selection ≠ execution | P5-02 AD-008 | FROZEN — MONITOR ≠ BUY/SELL |
| historical ≠ live recomputation | P5-05 §11 | FROZEN — historical decisions from artifacts only |
| decisionId is deterministic | P5-02 AD-013 | FROZEN — no random/sequence/wall-clock |
| presentation is pure transformation | P5-06C | FROZEN — no business rules in presentation |

### 8.2 P6 Boundary

| Check | Result | Note |
|---|---|---|
| P6 does NOT reinterpret P4/P5 | YES | P6-01 only added quality/freshness infrastructure |
| P5 historical/replay semantics protected | YES | P5-07 replay reads from persisted artifacts; P6 does not modify this path |
| No semantic leakage P6→P4 | YES | Feature engine is legacy P4; P6 has not modified it |
| No semantic leakage P6→P5 | YES | P5 decision pipeline is untouched by P6 |
| P6-02 must not break P4/P5 consumers | CRITICAL | Feature/health/recommendation table schemas must remain readable |

### 8.3 P5 Historical Integrity

P5-07 replay engine hard invariants:
- Historical artifacts always win over live state
- Deterministic: same decisionId + same recorded artifacts + same replayContractVersion → same report
- Replay ≠ re-execution: zero side effects, no policy/safety re-evaluation
- Results in replay-validation namespace, never in P5-02 DecisionOutcome vocabulary

**P6-02 must not break these invariants.** Any new intelligence outputs must be recorded as new artifacts, not modifications to existing P5 artifact paths.

---

## 9. Reusable Assets

| Asset | Reusable? | Adaptation needed |
|---|---|---|
| Feature calculation functions (trend, derivative, volume, momentum) | YES | Input source change (legacy DB → P6 observations) |
| Health score calculation (weighted sum) | YES | Must be extended with decomposition |
| Technical indicators (EMA, RSI, MACD, etc.) | YES | Already computed from klines; can be reused |
| Snapshot service (createDailySnapshot) | PARTIALLY | Must be extended with provenance and versioning |
| Narrative health calculation | YES | Must be extended with decomposition and provenance |
| P4 interpretation engine | FROZEN | Must not be modified; P6 must produce compatible inputs |
| P5 policy/safety/approval | FROZEN | Must not be modified; P6 must produce compatible inputs |
| P5 artifact recording | FROZEN | Must not be modified; P6 must record through existing path |
| P5 replay engine | FROZEN | Must not be modified; P6 must be compatible |
| `feature_versions` table | YES | Must be extended with structured version tuple |
| `rule_versions` table | YES | Must be extended with structured version tuple |
| `score_configs` table | YES | Must be extended with algorithm version coupling |

---

## 10. Gaps Summary

### 10.1 Critical Gaps (must be resolved before P6-02 implementation)

| # | Gap | Impact | Category |
|---|---|---|---|
| G-1 | Intelligence pipeline reads from legacy P3 tables, not P6 observations | Cannot consume quality/freshness | Architecture |
| G-2 | No observation-level provenance in feature/health/snapshot outputs | Cannot trace derivation to specific observations | Provenance |
| G-3 | No structured version tuple in any intelligence output | Cannot guarantee reproducibility | Versioning |
| G-4 | No snapshot reconstruction mechanism | Historical snapshots cannot be verified | Reproducibility |
| G-5 | No quality/freshness awareness in intelligence pipeline | Features may be computed from INVALID/STALE data | Semantic |

### 10.2 Important Gaps (should be resolved in P6-02/03)

| # | Gap | Impact | Category |
|---|---|---|---|
| G-6 | Health score has no dimension decomposition | P6-02B requires decomposable dimensions | Semantic |
| G-7 | Narrative health is computed in refresh route | Must become a P6-02 module | Architecture |
| G-8 | Morning snapshot lacks derivation trace | Cannot verify what inputs produced the snapshot | Provenance |
| G-9 | No algorithm parameter versioning | Cannot compare across algorithm versions | Versioning |
| G-10 | Feature engine is monolithic | Cannot be tested independently | Architecture |

### 10.3 Nice-to-Have Gaps (defer to later P6)

| # | Gap | Impact | Category |
|---|---|---|---|
| G-11 | No historical feature versioning (latest-only) | Cannot compare across versions | Versioning |
| G-12 | No feature output schema validation | Outputs could drift silently | Quality |
| G-13 | No snapshot comparison mechanism | Cannot verify snapshot stability | Reproducibility |

---

## 11. Candidate Planner Decisions

| # | Decision | Options | Dependency |
|---|---|---|---|
| CD-1 | Intelligence input source: legacy DB or P6 canonical observations? | A: Join legacy + P6 quality; B: Read from new P6 observation table | G-1 |
| CD-2 | Snapshot identity: date-based or observation-identity-based? | A: Keep date-based (current); B: Add observation-level identity | G-2 |
| CD-3 | Version tuple structure | A: `(algorithm, parameter, schema)` triple; B: Single version string | G-3 |
| CD-4 | Snapshot reconstruction: full or summary? | A: Record all inputs for full reconstruction; B: Record summary + hashes | G-4 |
| CD-5 | Quality gating in intelligence: skip, hedge, or pass-through? | A: Skip INVALID; B: Hedge with confidence; C: Pass-through with metadata | G-5 |
| CD-6 | Health decomposition: weighted sum, worst-case, or hybrid? | A: Weighted sum (current); B: Worst-case floor; C: Hybrid | G-6 |
| CD-7 | P6 snapshot vs morning snapshot: replace or extend? | A: Replace morning_snapshot with P6 snapshot; B: Extend with P6 metadata | G-8 |

---

## 12. Evidence Gaps

| # | Gap | Why needed | How to resolve |
|---|---|---|---|
| E-1 | Production morning_snapshot_headers row count | Understand snapshot volume | Production DB query |
| E-2 | P4 interpretation engine's exact dependency on feature fields | Ensure backward compatibility | P4 code audit |
| E-3 | P5 artifact recorder's exact dependency on decision fields | Ensure backward compatibility | P5 code audit |
| E-4 | Whether any external consumer reads snapshot data via API | API contract stability | API audit |
| E-5 | Actual production narrative count and membership size | Performance planning | Production DB query |
| E-6 | Whether P5 replay has been used in production | Historical integrity verification | Production audit |

---

## 13. Recommended Execution Graph

```text
P6-03A (this recon) ──────────────────────────────────────→
        │
        ├→ P6-02B (Health Dimension Definitions) ←── depends on P6-02A
        │       │
        │       ├→ P6-02C (Aggregation Contract)
        │       │       │
        │       │       └→ P6-02D (Algorithm V1)
        │       │               │
        │       │               └→ P6-02E (Snapshot Persistence)
        │       │                       │
        │       │                       └→ P6-02F (Tests)
        │       │                               │
        │       │                               └→ P6-02-FINAL
        │       │
        │       └→ P6-03B (Coin Health Contract) ←── depends on P6-02B
        │               │
        │               ├→ P6-03C (Breadth/Participation)
        │               │       │
        │               │       └→ P6-03D (Coin Snapshot)
        │               │               │
        │               │               └→ P6-03E (Tests)
        │               │                       │
        │               │                       └→ P6-03-FINAL
        │               │
        │               └→ [parallel with P6-02C/D/E]
        │
        └→ P6-02A (Feature Recon) ←── already completed (3ed1714)
```

**P6-02B is the immediate next task** (depends on P6-02A recon). P6-03B depends on P6-02B (shared dimension definitions). P6-02 and P6-03 can be parallelized after P6-02B is frozen.

---

## 14. Acceptance Checklist

- [x] All intelligence tables inventoried
- [x] All snapshot tables inventoried
- [x] P4/P5 components inventoried
- [x] Full data flow traced (source → feature → health → recommendation → narrative → snapshot → P4/P5)
- [x] Snapshot identity analyzed
- [x] Provenance chain analyzed
- [x] Versioning model analyzed
- [x] Reproducibility assessed
- [x] P4/P5 boundary verified
- [x] P5 historical integrity verified
- [x] Reusable assets identified
- [x] Gaps classified by severity
- [x] Candidate decisions identified
- [x] Evidence gaps documented
- [x] Execution graph proposed
- [x] No production code modified
- [x] No schema changes
- [x] No semantic decisions made
