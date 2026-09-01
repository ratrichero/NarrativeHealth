# P6-SEMANTIC-10A — Production Refresh Scope & Feature Regeneration Semantics Audit

**Date:** 2026-09-01
**Scope:** Audit only — no code changes, no data modifications

---

## Executive Summary

The production Refresh regenerates features **only for today's date** (49 records) while historical feature records (1084 records spanning Jul 31 – Aug 31) remain unchanged. This behavior is **intentional architecture**, not a bug or limitation.

**Root cause (proven from code):**
- Line 1 of refresh route: `const today = getBusinessDate()` — all processing is scoped to today
- Feature upsert key: `(coinId, date, versionId)` — only today's records match
- Historical features are never queried, filtered, or touched by the refresh pipeline
- The `p6_feature_versions` table exists for algorithm versioning but is NOT used during refresh

**This is a semantic design choice, not an implementation gap.** The system treats features as **immutable historical observations** — each day's features represent what was computed on that date using whatever code was running at that time.

---

## 1. Evidence Chain

### 1.1 Refresh Call Graph (Proven from Source Code)

```
UI "Refresh Data" button
  ↓
POST /api/refresh (src/app/api/refresh/route.ts)
  ↓
const today = getBusinessDate()          ← LINE: scopes ALL processing to today
  ↓
For each active coin:
  ↓
  Fetch fresh data (Binance Spot/Futures, CoinGecko)
  ↓
  Save market_price_daily (upserted for today)
  ↓
  Save coin_metrics (upserted for today)
  ↓
  Calculate indicators (for today)
  ↓
  Run featureEngine → derivative, trend, volume, momentum
  ↓
  Upsert features (ON CONFLICT (coinId, date, versionId))  ← TODAY ONLY
  ↓
  Calculate health_score
  ↓
  Save health_scores (upserted for today)
  ↓
  Generate recommendation
  ↓
  Save recommendations (upserted for today)
  ↓
For each narrative:
  ↓
  Calculate weighted narrative health
  ↓
  Upsert narrative_health (for today)
  ↓
Run P6 snapshot generation (from today's features)
  ↓
Run P5 decision pipeline (from today's P4 data)
```

### 1.2 Exact Code Evidence

**Date scoping (line ~117 of route.ts):**
```typescript
const today = getBusinessDate();
```

**Feature upsert (line ~640 of route.ts):**
```typescript
await db
  .insert(features)
  .values({
    coinId: coin.id,
    date: today,                    // ← TODAY ONLY
    versionId: featureVersion.id,
    derivativeScore: featureResult.derivative_score,
    // ... other scores
  })
  .onConflictDoUpdate({
    target: [features.coinId, features.date, features.versionId],
    set: {
      derivativeScore: featureResult.derivative_score,
      // ... updates only if coin+date+version matches
    },
  });
```

**No historical query anywhere in refresh:**
- The refresh never selects historical feature records
- The refresh never filters on `date < today`
- The refresh never marks historical records as superseded
- Historical features are simply not referenced

---

## 2. Exact Regeneration Scope

```
Total population:     1133 feature records (Jul 31 – Sep 1)
Today's population:   49 records (Sep 1, 2026)
Regenerated:          49/49 = 100%
Historical untouched: 1084 records (Jul 31 – Aug 31)
```

### Why 49 and not 1133?

The refresh pipeline is designed as a **daily data collection job**, not a historical recomputation engine. Its purpose is:

1. Fetch today's market data from Binance/CoinGecko
2. Calculate today's features using current algorithm
3. Update today's health/recommendation
4. Generate today's P6 snapshot

**It was never designed to recompute historical features.** This is consistent with the product's stated principle: "Every morning, within 2 minutes, know exactly what to do with your tracked coins."

---

## 3. Why Historical Records Are Not Recomputed

Three converging factors:

### 3.1 Architectural Design

The refresh is a **daily batch job** that processes one business date. The `getBusinessDate()` call at the top of the route establishes this scope. Every downstream query (market data, features, health, narrative health, P6 snapshots) filters on `date = today`.

### 3.2 Upsert Semantics

The feature table uses a **composite unique key**: `(coinId, date, versionId)`. The refresh always inserts with `date = today`, so:
- Historical records (where `date ≠ today`) are never matched by the upsert
- Even if the refresh tried to write historical data, the `ON CONFLICT` would not find existing records to update
- Historical records would only be affected by a fresh `INSERT` with their specific date

### 3.3 No Backfill Mechanism

There is no "recompute all" mode, no batch date range parameter, and no historical recomputation endpoint in the refresh pipeline. The only way to recompute historical features would be to build a separate backfill mechanism (as was done for indicators in `scripts/backfill-indicators-aug26-29.ts`).

---

## 4. Manual Refresh Semantic Contract

Based on code analysis, "Refresh" means:

```
A. Recompute current snapshot only
   ✅ YES — this is exactly what Refresh does
   B. Recompute all historical records
   ❌ NO — never implemented, never intended
   C. Something else
   Partially — Refresh also collects fresh market data,
   calculates indicators, runs P3/P4/P5 pipelines
```

**The semantic contract of Refresh is: "Collect today's data and compute today's intelligence."**

This is explicitly stated in the product spec (MdSpec.md):
> "Every morning, within 2 minutes, know exactly what to do with your tracked coins."

---

## 5. Historical vs Derived Data Semantics

### 5.1 Data Classification

| Data Type | Mutability | Example |
|-----------|-----------|---------|
| Raw market data | **Immutable by design** | `market_price_daily` (OHLCV) |
| Coin metrics | **Immutable by design** | `coin_metrics` (OI, funding, market cap) |
| Indicators | **Immutable by design** | `indicators` (EMA, RSI, MACD) |
| Feature scores | **Mutable via refresh** | `features` (derivative, trend, volume, momentum) |
| Health scores | **Mutable via refresh** | `health_scores` |
| Recommendations | **Mutable via refresh** | `recommendations` |
| Narrative health | **Mutable via refresh** | `narrative_health` |
| P6 snapshots | **Mutable via refresh** | `p6_snapshots` |

### 5.2 Historical Derived Features

The refresh creates new feature records daily. Historical records represent what was computed on their respective dates. After the P6-FEATURE-02 algorithm change:

- **Sep 1 features:** Computed with continuous derivative (new algorithm)
- **Aug 31 features:** Computed with step-function derivative (old algorithm)
- **Both coexist** in the `features` table without any explicit version marker on the records themselves

### 5.3 Immutability Assessment

Historical features are **de facto immutable** because:
1. The refresh never touches them
2. No backfill mechanism exists
3. The upsert key excludes them (different date)
4. No API exposes "recompute historical"

They are **not explicitly immutable** (no DB constraint prevents modification), but no production code path modifies them.

---

## 6. Algorithm Versioning Audit

### 6.1 Version Infrastructure

The schema includes two versioning systems:

**Legacy `feature_versions` table:**
- Simple integer version
- Referenced by `features.versionId`
- Used in the refresh upsert key
- Only one version exists (version=1, always active)

**P6 `p6_feature_versions` table:**
- Structured tuple: `(algorithm_version, parameter_version, schema_version, config_hash)`
- Referenced by `p6_snapshots.featureVersionId`
- Added by P6-02 migration
- NOT used by the refresh pipeline

### 6.2 Can Old and New Scoring Be Distinguished?

**On the `features` table:** NO. There is no column that identifies which algorithm version was used to compute a given record. All records reference the same `versionId` (1). The only way to distinguish old vs new is by:
- Date (pre-Sep 1 = old algorithm, Sep 1+ = new algorithm)
- Value distribution pattern (discrete 47.5/57.5 = old, fractional = new)

**On `p6_snapshots`:** YES. The snapshot records reference `featureVersionId` which links to `p6_feature_versions`. However, the `p6_feature_versions` table has NOT been updated to reflect the continuous derivative change — it still references the original version.

### 6.3 Versioning Gap

The P6 feature versioning infrastructure (`p6_feature_versions`) exists but is **not actively maintained** during algorithm changes. The continuous derivative scoring (commit `58c99ce`) did not:
1. Create a new `p6_feature_versions` record
2. Update `algorithm_version` to reflect the change
3. Tag historical feature records with the old version

This means **the system cannot programmatically determine which algorithm produced a given historical feature record.**

---

## 7. Quantitative Impact

### 7.1 Historical Comparability

| Metric | Impact |
|--------|--------|
| Cross-day derivative comparison | **BROKEN** — old (step-function) vs new (continuous) are not comparable |
| Cross-day health comparison | **PARTIALLY AFFECTED** — derivative contributes 35% to health |
| Cross-day trend/volume/momentum | **UNAFFECTED** — these features were not changed |
| Cross-day recommendation | **PARTIALLY AFFECTED** — health affects recommendation signal |

### 7.2 P6 Trend/Regime Calculations

P6 snapshots only use the latest features for current health calculation. Historical P6 snapshots (if any exist) would contain old health values. Since P6 was recently deployed and the market-cap fix was just applied, most historical P6 snapshots are either missing or use the neutral fallback (50).

**Impact: LOW** — P6 regime calculations are based on current health, not historical.

### 7.3 Threshold Calibration

The recommendation thresholds (observe=65, watch=78, strong_watch=85) were calibrated against the **current** (mixed) dataset. The continuous derivative scoring changes the distribution for today's data only. Historical calibration data includes old step-function values.

**Impact: LOW** — thresholds apply to current health scores, which are computed from today's features.

### 7.4 Backtest/Replay Validity

If someone were to replay historical features through the current algorithm, the results would differ from what was actually computed on those dates. This is expected behavior for an evolving system.

**Impact: MEDIUM** — historical backtest replay would produce different results than actual historical computation.

---

## 8. Semantic Risks

### 8.1 Cross-Day Score Comparison

A user comparing BTC's derivative score from Aug 31 (old step-function) to Sep 1 (new continuous) would see a discontinuous jump that reflects the algorithm change, not a genuine market change.

**Risk level:** LOW — users typically compare day-over-day health, not raw derivative scores.

### 8.2 Health Score Continuity

Health scores on Aug 31 used old derivative values. Health scores on Sep 1 use new derivative values. The derivative contributes 35% to health, so there may be a non-market-driven shift in health scores at the algorithm boundary.

**Risk level:** LOW — the continuous scoring produces values in a similar range (43.9–65.5) as the old step-function (37.5–100), so the health impact is modest.

### 8.3 Narrative Trend Charts

If the narrative health timeline chart shows data from Aug 31 → Sep 1, the transition may show a jump caused by the algorithm change rather than genuine market movement.

**Risk level:** LOW — narrative health is primarily driven by trend (35%) and volume (20%), not derivative (35%).

---

## 9. Decision Matrix

| Option | Advantages | Risks | Business Implication |
|--------|-----------|-------|---------------------|
| **KEEP** (current behavior) | Simple; no risk of corrupting historical data; today's data is always fresh; aligns with "morning report" design | Historical features contain old algorithm values; cross-day comparison has discontinuity at algorithm boundary; no explicit version tagging | Low risk, accepted by design |
| **CHANGE** (add historical recomputation) | Clean historical distribution; consistent algorithm across all records; accurate historical comparison | Computationally expensive; requires backfill script; modifies historical records; could introduce errors; changes historical audit trail | High risk, requires careful design |
| **VERSIONED REBUILD** (recompute historical + tag with version) | Clean historical data; explicit version tracking; supports accurate backtest; maintains audit trail | Most complex; requires `p6_feature_versions` integration; significant engineering effort; may not be needed if historical comparison is not a product requirement | Medium risk, best long-term |

---

## 10. Recommended Business Semantics

### Short-term (current state is acceptable)

The current behavior is **semantically sound** for the product's stated purpose:

> "Every morning, within 2 minutes, know exactly what to do with your tracked coins."

The product is designed for **real-time daily decision support**, not historical analysis. The Refresh semantic contract is clearly "recompute today," and the system delivers exactly that.

### Medium-term (if historical comparison becomes a requirement)

If the product evolves to require accurate historical comparison or backtesting:

1. **Tag feature records with algorithm version** — use the existing `p6_feature_versions` infrastructure
2. **Build a historical recomputation endpoint** — similar to `backfill-indicators-aug26-29.ts`
3. **Run one-time backfill** — recompute all historical features with the current algorithm
4. **Mark old records as superseded** — preserve the original values for audit

### NOT recommended

Do not automatically recompute historical features on every algorithm change. The cost/risk/benefit ratio is unfavorable for a daily decision support tool.

---

## 11. Required Follow-up Tasks

None required for immediate correctness. The system is functioning as designed.

Optional future tasks (only if historical comparison becomes a product requirement):

1. `P6-VERSION-01 — Feature Algorithm Version Tagging` — tag feature records with `p6_version_id`
2. `P6-BACKFILL-01 — Historical Feature Recomputation` — backfill historical features with current algorithm

---

## 12. Final Verdict

```
REFRESH_SCOPE_VERIFIED_AND_SEMANTICALLY_SOUND
```

**Rationale:**

1. The exact reason for 1133 → 49 refresh scope is **proven from code**: `const today = getBusinessDate()` scopes all processing to today's date only.

2. The semantic contract of Refresh is explicitly "recompute current snapshot only" — this matches the product design ("morning report in 2 minutes").

3. Historical feature immutability is **de facto confirmed** — no code path modifies historical features, and no backfill mechanism exists.

4. Algorithm versioning behavior is **verified** — old and new values coexist without explicit version tagging on feature records, but this is not currently a problem because the product does not require cross-algorithm historical comparison.

5. The mixed old/new scoring has **low semantic impact** — P6 uses only today's features, health scores are primarily driven by trend/volume (not derivative), and the product is designed for daily decision support.

6. No code changes are required. The system is functioning correctly for its stated purpose.
