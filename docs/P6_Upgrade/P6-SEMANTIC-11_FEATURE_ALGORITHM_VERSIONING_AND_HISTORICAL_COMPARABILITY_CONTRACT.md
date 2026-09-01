# P6-SEMANTIC-11 — Feature Algorithm Versioning & Historical Comparability Contract

**Task:** P6-SEMANTIC-11  
**Date:** September 1, 2026  
**Author:** Buffy (Codebuff)  
**Status:** COMPLETE  
**Verdict:** `VERSIONING_GAP_FOUND_REQUIRES_CONTRACT`

---

## 1. Executive Summary

P6-FEATURE-02 replaced derivative step-function scoring with continuous tanh-based scoring (commit `58c99ce`). The production database now contains **heterogeneous algorithm generations**: historical feature records computed by the old V1 step-function, and current records computed by the new V2 continuous algorithm. No record in the database identifies which algorithm generated its values.

Two versioning infrastructure tables exist (`feature_versions` and `p6_feature_versions`), but **neither is wired into the refresh pipeline or feature persistence code**. The `p6_version_id` column exists on the `features` table but is always NULL because no code populates it. The `version_id` column is populated but always references the same single record (version=1, the original algorithm).

This creates a concrete semantic gap: the system cannot distinguish V1 from V2 feature records without heuristic date-based inference. While this is **functionally harmless for the current "today-only" operational model**, it becomes a real risk if historical replay, backtesting, or cross-day trend analysis is ever implemented.

**Final Verdict:** `VERSIONING_GAP_FOUND_REQUIRES_CONTRACT`

---

## 2. Evidence Sources

| Source | Path | Purpose |
|--------|------|---------|
| Features schema | `src/db/schema.ts` | Table definitions, constraints, FKs |
| Feature version schema | `src/db/schema.ts` | `featureVersions`, `p6FeatureVersions` |
| Derivative algorithm (new) | `src/lib/features/derivative.ts` | Continuous scoring implementation |
| Feature engine | `src/lib/features/engine.ts` | Pipeline orchestration |
| Refresh route | `src/app/api/refresh/route.ts` | Production refresh pipeline |
| P6-02E migration | `scripts/apply-p6-02e-migration.ts` | `p6_feature_versions` DDL |
| Backend seed | `backend/api/admin.py` | Initial `feature_versions` seed |
| Historical data | P6-SEMANTIC-10 production audit | Distribution evidence |

---

## 3. Existing Version Infrastructure

### 3.1 `feature_versions` Table

```typescript
// src/db/schema.ts
export const featureVersions = pgTable("feature_versions", {
  id: serial("id").primaryKey(),
  version: integer("version").notNull(),          // integer version number
  description: text("description"),               // human-readable
  algorithm: jsonb("algorithm"),                  // algorithm details JSON
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Current state:**
- Seeded with **1 record**: version=1, description="Initial version - pandas EMA, ROC, ATR calculations"
- Referenced by `features.version_id` (NOT NULL FK)
- Part of the features unique constraint: `(coin_id, date, version_id)`
- **Never updated** when derivative algorithm changed in P6-FEATURE-02

### 3.2 `p6_feature_versions` Table

```typescript
// src/db/schema.ts
export const p6FeatureVersions = pgTable("p6_feature_versions", {
  id: serial("id").primaryKey(),
  algorithmVersion: text("algorithm_version").notNull(),
  parameterVersion: text("parameter_version").notNull(),
  schemaVersion: text("schema_version").notNull(),
  configHash: text("config_hash").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  activatedAt: timestamp("activated_at"),
}, (table) => [
  unique("p6_feature_version_unique").on(
    table.algorithmVersion, table.parameterVersion,
    table.schemaVersion, table.configHash
  ),
]);
```

**Current state:**
- Created by migration `p6-02e` (additive, does not replace `feature_versions`)
- `features.p6_version_id` FK references this table (nullable)
- `p6_version_id` is **always NULL** in production — no code writes to it
- Designed for structured version tuples but **never activated**

### 3.3 `features.version_id` (Legacy)

```typescript
versionId: integer("version_id")
  .notNull()
  .references(() => featureVersions.id),
```

- Always references `feature_versions.id = 1`
- Part of upsert key: `(coin_id, date, version_id)`
- Since only one version exists, this effectively means "all records are V1"

### 3.4 `features.p6_version_id` (P6 Additive)

```typescript
p6VersionId: integer("p6_version_id")
  .references(() => p6FeatureVersions.id, { onDelete: "set null" }),
```

- Nullable, not part of any unique constraint
- **Never populated by any code path**
- Created for future use but never wired

### 3.5 Infrastructure Assessment

| Component | Exists | Wired | Used | Effective |
|-----------|--------|-------|------|-----------|
| `feature_versions` | ✅ | ✅ (FK) | ✅ (always V1) | **No differentiation** |
| `p6_feature_versions` | ✅ | ❌ (FK only) | ❌ (no rows) | **Unused** |
| `features.p6_version_id` | ✅ | ✅ (FK) | ❌ (always NULL) | **Dead column** |
| `features.p6_provenance` | ✅ | ✅ (column) | ❌ (always NULL) | **Dead column** |
| Feature code version field | ❌ | — | — | **Not implemented** |

---

## 4. Current Algorithm Boundary

### 4.1 V1 (Step-Function)

- **Files:** `src/lib/features/derivative.ts` (pre-`58c99ce`)
- **OI scoring:** 5 discrete buckets: 20/40/60/75/90
- **Funding scoring:** 5 discrete buckets: 15/35/55/75/90
- **Output:** 11–15 unique values, 79% concentrated at 47.5/57.5
- **Evidence:** P6-FEATURE-01 documented old distribution

### 4.2 V2 (Continuous)

- **Files:** `src/lib/features/derivative.ts` (commit `58c99ce` and later)
- **OI scoring:** `tanh(pct/15)` → continuous [10, 90]
- **Funding scoring:** Linear mapping → continuous [15, 90]
- **Output:** 45+ unique values on Sep 1, 0% legacy concentration
- **Evidence:** P6-SEMANTIC-10 production audit confirmed clean distribution for today's records

### 4.3 Boundary Evidence Table

| Date Range | Algorithm | Derivative Unique Values | Legacy Concentration |
|------------|-----------|------------------------:|---------------------:|
| Aug 22–31 | V1 (step-function) | 5–8 per day | ~79% |
| Sep 1+ | V2 (continuous) | 45 (today only) | 0% |

**The boundary is:** features for dates before Sep 1 used the old algorithm; features for Sep 1+ use the new algorithm. The boundary is **implicit** (date-based) rather than **explicit** (version-tagged).

### 4.4 Mixed-Record Risk

Since the refresh pipeline only processes today, and the system only displays current data:

- **Current operational risk: NONE** — only today's features are displayed
- **Historical replay risk: HIGH** — replaying Aug 31 would use current V2 code, producing different values than what was actually generated
- **Cross-day trend risk: MEDIUM** — if rolling windows span the boundary (e.g., 7-day trend), old and new derivative values are compared directly
- **Backtest risk: HIGH** — backtests would silently use V2 code on V1-era data

---

## 5. Historical Feature Semantics

### 5.1 Data Classification

| Category | Type | Immutability | Example |
|----------|------|:------------:|---------|
| A. Raw market data | Observed | Immutable | `market_price_daily`, `coin_metrics` |
| B. Derived features | Algorithm-generated | **Should be immutable once generated** | `features`, `indicators` |
| C. P6 intelligence outputs | Computed from B | Derived, regenerable | `p6_snapshots`, `p6_regime_states` |

### 5.2 Current Behavior

- **Raw market data (A):** Immutable by design (UPSERT by coin+date, historical never touched)
- **Derived features (B):** **NOT immutable in practice** — refresh overwrites today's features with the latest algorithm. Historical features are preserved only because refresh doesn't process them.
- **P6 outputs (C):** Regenerated daily, old snapshots retained with CURRENT/SUPERSEDED lifecycle

### 5.3 Semantic Verdict

The system **implicitly treats features as immutable** (by only processing today), but this is an **implementation artifact** rather than an **enforced contract**. If a backfill or multi-date refresh were ever run, historical features would be silently overwritten with the new algorithm — destroying the historical record.

---

## 6. Historical Comparability Matrix

| Metric | V1→V2 Comparability | Risk | Classification |
|--------|:-------------------:|------|----------------|
| Derivative score | **NOT directly comparable** | Different distributions, ranges, concentration | `NOT_COMPARABLE` |
| Trend score | COMPARABLE | Unchanged algorithm | `COMPARABLE` |
| Volume score | COMPARABLE | Unchanged algorithm | `COMPARABLE` |
| Momentum score | COMPARABLE | Unchanged algorithm | `COMPARABLE` |
| Health score | **CONDITIONALLY** | Dominated by trend, but derivative at 35% weight | `CONDITIONALLY_COMPARABLE` |
| Narrative health | **CONDITIONALLY** | Depends on coin-level health | `CONDITIONALLY_COMPARABLE` |
| P6 regime | CONDITIONALLY | Depends on health | `CONDITIONALLY_COMPARABLE` |
| Recommendation | CONDITIONALLY | Depends on health + thresholds | `CONDITIONALLY_COMPARABLE` |
| Percentile distribution | **NOT comparable** | Different cardinality/spread | `NOT_COMPARABLE` |
| Cross-day derivative change | **NOT meaningful** | Step-function delta vs continuous delta | `NOT_COMPARABLE` |

### 6.1 Key Incompatibility

A change such as:

```
Aug 31 derivative = 47.5 (V1 step-function)
Sep 1 derivative = 51.6 (V2 continuous)
```

**Cannot be legitimately interpreted as "derivative improved by 4.1 points."** It may simply represent an algorithm-generation change. Without version tagging, this ambiguity is permanent.

---

## 7. P6 Trend / Regime Impact

### 7.1 How Historical Features Are Consumed

The P6 snapshot service (`src/lib/p6/snapshot/service.ts`) reads current features for today only:

```typescript
const calculatedAt = new Date(); // today
```

P6 regime states use a consecutive-count mechanism. If a window crosses the algorithm boundary (e.g., Sep 1 vs Aug 31), the system compares health scores generated by different algorithms. However:

- Regime uses **health score**, not raw features directly
- Health score is dominated by **trend** (35%, unchanged) and **derivative** (35%, changed)
- The net effect depends on whether the derivative change pushes health across a regime boundary

### 7.2 Concrete Risk Assessment

| Scenario | Risk | Current Impact |
|----------|------|----------------|
| Today-only display | None | System only shows today |
| 7-day rolling comparison | Low | Only if data spans boundary |
| Regime consecutive count | Low | Only if regime spans boundary |
| Historical chart display | Medium | Charts show mixed-generation data |
| Backtest replay | High | Would silently produce different values |

### 7.3 Conclusion

For the current operational model (today-only refresh + display), the cross-boundary risk is **low**. The risk becomes **material** only if historical analysis features are implemented.

---

## 8. Calibration Impact

### 8.1 Health Distribution

- Recommendation thresholds (P6-CONFIG-01) were calibrated on current data (Sep 1, V2)
- Historical thresholds were never recalibrated for V1
- **Current risk: NONE** — thresholds are applied only to today's data

### 8.2 Feature Weights

- Health weights (trend 0.35, derivative 0.35, volume 0.20, momentum 0.10) are applied uniformly
- The derivative weight applies to both V1 and V2 values without discrimination
- **If derivative weight were recalibrated**, it should be done on V2 data only

### 8.3 Calibration Dataset Requirements

For future calibration:

| Approach | Correct? | Risk |
|----------|:--------:|------|
| All historical versions | ❌ | Mixing V1/V2 corrupts calibration |
| Current-version-only | ✅ | Clean but requires version filtering |
| Version-normalized | ⚠️ | Possible but complex, error-prone |
| Separate per-version | ✅ | Cleanest but requires version tagging |

**Recommendation:** Calibrate on current-version data only, with explicit version filtering.

---

## 9. Replay / Backtest Semantics

### 9.1 Current Behavior

No replay or backtest engine exists in production. The roadmap (MdSpec.md §14) lists "Backtest Engine" as a Phase 3 goal.

### 9.2 Two Distinct Concepts Needed

| Concept | Definition | Use Case |
|---------|-----------|----------|
| `HISTORICAL_REPLAY` | Reproduce exactly what the system produced at time T, using the algorithm version active at T | Audit, compliance, debugging |
| `CURRENT_ALGORITHM_BACKTEST` | Recompute historical observations using the current (latest) algorithm | Strategy development, parameter optimization |

### 9.3 Current System Supports Neither

- No version tagging → cannot select the correct algorithm for replay
- No backfill mechanism → cannot recompute with current algorithm
- No reproducibility guarantee → same code + same data may produce different results if algorithm changed

---

## 10. Versioning Design Options

### Option A — Date-Based Implicit Versioning

```
feature record date < boundary_date → V1
feature record date >= boundary_date → V2
```

| Aspect | Assessment |
|--------|-----------|
| Correctness | Partial — relies on knowing the boundary date |
| Auditability | Low — boundary must be documented externally |
| Storage impact | Zero |
| Migration complexity | Zero |
| Replay implications | Cannot replay pre-boundary with V1 code |
| Operational complexity | Low |
| Silent semantic mixing risk | **HIGH** — no explicit guard |

### Option B — Feature Record Stores Explicit `algorithm_version`

Add an `algorithm_version` TEXT column to `features`, populated by the refresh pipeline.

| Aspect | Assessment |
|--------|-----------|
| Correctness | High — each record self-identifies |
| Auditability | High — SQL queries can filter by version |
| Storage impact | Negligible (one TEXT column) |
| Migration complexity | Low (ADD COLUMN, backfill boundary) |
| Replay implications | Can select records by version |
| Operational complexity | Low — one extra field in upsert |
| Silent semantic mixing risk | **LOW** — explicit, queryable |

### Option C — Feature Record References Version Registry

Use the existing `p6_version_id` FK to `p6_feature_versions`.

| Aspect | Assessment |
|--------|-----------|
| Correctness | High — normalized, structured |
| Auditability | High — joinable, indexable |
| Storage impact | Low (one integer FK) |
| Migration complexity | Medium — must create V2 registry row, wire persistence code |
| Replay implications | Can filter by version registry |
| Operational complexity | Medium — version lifecycle management |
| Silent semantic mixing risk | **LOW** — FK constraint enforces |

### Option D — Separate Immutable Historical + Recomputed Dataset

Keep original features immutable; maintain a parallel "recomputed" dataset using current algorithm.

| Aspect | Assessment |
|--------|-----------|
| Correctness | Highest — preserves both truths |
| Auditability | Highest — both datasets independently queryable |
| Storage impact | High (2× feature storage) |
| Migration complexity | High — new table, dual-write, reconciliation |
| Replay implications | Perfect — original preserved, recomputation available |
| Operational complexity | High — dual pipeline, consistency management |
| Silent semantic mixing risk | **MINIMAL** — explicit separation |

---

## 11. Proposed Versioning Contract

### 11.1 Recommended Design: **Option C (Version Registry) + Option A (Date Boundary as Fallback)**

The existing `p6_feature_versions` table and `features.p6_version_id` column provide the structural foundation. The missing piece is **wiring them into the refresh pipeline**.

### 11.2 Contract Definition

```
ALGORITHM VERSIONING CONTRACT v1.0
═══════════════════════════════════

§1  ALGORITHM IDENTITY
    Every feature record MUST identify the algorithm that generated it.
    Primary: p6_version_id → p6_feature_versions
    Fallback: algorithm_version text field

§2  VERSION IDENTITY
    A version is a 4-tuple: (algorithm_version, parameter_version, schema_version, config_hash)
    Each unique combination gets a registry entry in p6_feature_versions.
    Only one version may be is_active=true at any time.

§3  ACTIVATION
    When code changes that alter feature calculation:
    1. Create new p6_feature_versions row with incremented algorithm_version
    2. Set old version is_active=false
    3. New refresh runs use new version_id

§4  FEATURE IDENTITY
    Feature uniqueness remains: (coin_id, date, version_id)
    Historical records from old versions are IMMUTABLE.

§5  IMMUTABILITY
    Once a feature record is persisted with version V, it MUST NOT be overwritten
    by version V' ≠ V. The refresh pipeline MUST only write records for the
    CURRENT active version.

§6  COEXISTENCE
    Multiple versions may coexist in the features table.
    Old records retain their original version_id.
    New records use the new version_id.
    Queries must specify version or use "latest" semantics.

§7  RECALCULATION
    Historical recalculation with a new algorithm creates NEW records
    (with new version_id), never overwrites old records.
    This is analogous to git branches — old commits preserved, new work on top.

§8  REPLAY
    HISTORICAL_REPLAY: filter features by version matching the replay timestamp
    CURRENT_ALGORITHM_BACKTEST: filter features by current active version
    Both must be explicitly requested, never implicit.

§9  CALIBRATION
    Calibration datasets MUST specify which version(s) they include.
    Cross-version calibration is PROHIBITED without explicit normalization.

§10 CROSS-VERSION COMPARISON
    Direct comparison of feature scores across versions is PROHIBITED
    for metrics that changed between versions (currently: derivative).
    UIs and reports MUST indicate version boundaries.
```

### 11.3 "After an algorithm changes, what happens to yesterday's feature record?"

**Answer:** Yesterday's feature record remains exactly as it was, tagged with the old algorithm version. Today's refresh generates new records tagged with the new algorithm version. Both coexist. The system displays today's data using today's version. Historical queries must explicitly choose which version to read.

---

## 12. Migration / Implementation Boundary

### 12.1 MUST CHANGE

| Area | Change | Risk |
|------|--------|------|
| Feature persistence | Write `p6_version_id` during upsert | Low |
| Refresh pipeline | Resolve active `p6_feature_versions` row | Low |
| Version registry | Create V2 entry for continuous derivative | Low |

### 12.2 MAY CHANGE

| Area | Change | Risk |
|------|--------|------|
| Feature upsert key | Add `p6_version_id` to unique constraint | Medium (data migration needed) |
| Feature engine | Return algorithm_version in output | Low |
| UI | Display version indicator on historical charts | Low |

### 12.3 MUST NOT CHANGE

| Area | Reason |
|------|--------|
| P3/P4/P5 semantics | Frozen contracts |
| Health weights | Separate calibration task |
| Recommendation thresholds | Separate calibration task |
| Derivative algorithm | Already validated |
| Raw market data | Immutable by design |

---

## 13. Decision Matrix

| Approach | Historical Integrity | Analytical Comparability | Replay Fidelity | Implementation Complexity | Operational Risk | Recommended Use Case |
|----------|:-------------------:|:-----------------------:|:---------------:|:------------------------:|:----------------:|---------------------|
| A. Date-based | ⚠️ Implicit | ⚠️ Fragile | ❌ None | ✅ Zero | ⚠️ Medium | Quick fix, low priority |
| B. Explicit text version | ✅ Good | ✅ Good | ⚠️ Partial | ✅ Low | ✅ Low | **Minimum viable** |
| C. Version registry (FK) | ✅ Good | ✅ Good | ⚠️ Partial | ⚠️ Medium | ✅ Low | **Recommended** |
| D. Dual dataset | ✅ Best | ✅ Best | ✅ Full | ❌ High | ✅ Lowest | Future backtest engine |

---

## 14. Recommended Business Semantics

### 14.1 Current State

The system **works correctly** for its stated purpose: "Every morning, within 2 minutes, know exactly what to do with your tracked coins."

The versioning gap is **operationally invisible** because:
1. Only today's features are displayed
2. Only today's features are computed
3. Historical features are never recomputed
4. No backtest engine exists yet

### 14.2 Forward-Looking Recommendation

**Option C (Version Registry) is recommended** as the minimum correct implementation:

1. Register V2 in `p6_feature_versions` with descriptive version tuple
2. Wire `p6_version_id` into the refresh pipeline's feature upsert
3. Keep existing unique constraint `(coin_id, date, version_id)` — allows V1 and V2 records to coexist
4. Add a `current_algorithm_version` constant in the feature engine
5. Document the V1→V2 boundary date (Sep 1, 2026)

**Estimated implementation:** ~50 lines of code across 2 files. No schema migration required (columns already exist). No data migration required (existing records get NULL p6_version_id, which is acceptable until backfill is needed).

### 14.3 What NOT To Do

- ❌ Do NOT backfill historical V1 records with V2 algorithm values
- ❌ Do NOT force all records to the same version
- ❌ Do NOT implement dual-dataset architecture (overengineered for current needs)
- ❌ Do NOT modify the derivative algorithm again (P6-FEATURE-02 is validated)

---

## 15. Follow-up Tasks

| Priority | Task | Justification |
|:--------:|------|---------------|
| 1 | **P6-VERSION-01** — Wire `p6_version_id` into refresh pipeline | Close the versioning gap with minimal code change |
| 2 | **P6-CONFIG-02** — Health weight recalibration on clean distribution | Derivative now has proper discrimination (P6-FEATURE-02) |
| 3 | **P6-BACKTEST-01** — Historical replay design (future) | Only needed when backtest engine is implemented |

---

## 16. Final Verdict

```
VERSIONING_GAP_FOUND_REQUIRES_CONTRACT
```

### Rationale

1. **Two versioning tables exist** (`feature_versions`, `p6_feature_versions`) but neither is wired into the feature persistence code path
2. **`p6_version_id` is always NULL** — the P6-02E migration created the infrastructure but no code populates it
3. **V1 and V2 features coexist** without explicit version tagging — distinguishable only by date heuristics
4. **The gap is operationally harmless** for today's "today-only" display model
5. **The gap becomes a real risk** if historical replay, backtest, or cross-day trend analysis is implemented
6. **The fix is minimal** — ~50 lines of code to wire existing infrastructure

The contract defined in §11 provides the semantic foundation for safe algorithm evolution going forward.

---

*Report generated from actual code, schema, migration, and production data evidence.*
*No production code was modified in this task.*
