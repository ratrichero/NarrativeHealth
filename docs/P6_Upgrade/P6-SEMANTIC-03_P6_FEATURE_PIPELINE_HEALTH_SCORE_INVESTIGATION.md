# P6-SEMANTIC-03 — P6 Feature Pipeline Health Score Investigation

**Date:** 2026-09-01
**Auditor:** Buffy (Codebuff)
**Scope:** Root cause analysis of P6 health = 50 for all narratives
**Method:** Production data query + source code trace
**Previous hypothesis:** Feature scores NULL (P6-SEMANTIC-02)
**Actual finding:** Feature scores are NOT NULL — `market_cap` is missing in narrative aggregation

---

## 1. Executive Summary

**The P6-SEMANTIC-02 hypothesis was WRONG.** Feature scores (`trend_score`, `momentum_score`, `volume_score`, `derivative_score`) are fully populated in the `features` table — 1123 rows with zero NULL values across all 49 coins over 33 days.

**The actual root cause is `market_cap` being hardcoded to `null` in the narrative snapshot service**, which causes the market-cap weighted aggregation to find zero usable members and fall back to `SNAPSHOT_NEUTRAL_SCORE = 50`.

The fix is **NOT** to repair the feature pipeline. The feature pipeline works correctly. The fix is to supply `market_cap` data to the narrative snapshot aggregation, likely from the existing `coin_metrics` table which already stores `market_cap`.

---

## 2. Current Production Evidence

### 2.1 Feature Score Distribution (Last 30 Days)

| Metric | NULL | Non-NULL | Total |
|--------|------|----------|-------|
| trend_score | 0 | 1123 | 1123 |
| momentum_score | 0 | 1123 | 1123 |
| volume_score | 0 | 1123 | 1123 |
| derivative_score | 0 | 1123 | 1123 |

**Feature scores are 100% populated.** The P6-SEMANTIC-02 hypothesis is disproven.

### 2.2 Feature Date Range

| Metric | Value |
|--------|-------|
| Earliest | 2026-07-31 |
| Latest | 2026-09-01 |
| Distinct dates | 33 |
| Distinct coins | 49 |
| Total rows | 1133 |

### 2.3 Coin-Level P6 Snapshots (Real Health Scores)

| Entity ID | Health Score | Regime State |
|-----------|-------------|--------------|
| 53 | 63.38 | STABLE |
| 54 | 25.88 | STABLE |
| 55 | 50.75 | STABLE |
| 56 | 56.38 | STABLE |
| 57 | 54.88 | STABLE |
| 58 | 48.88 | STABLE |
| 59 | 37.38 | STABLE |

**Coin snapshots have real, varied health scores** — NOT the neutral 50.

### 2.4 Narrative-Level P6 Snapshots (ALL 50)

| Entity ID | Health Score | Regime State |
|-----------|-------------|--------------|
| 1 (AI) | 50 | STABLE |
| 2 (RWA) | 50 | STABLE |
| 3 (TOPMC) | 50 | STABLE |
| 4 (FAVORITE) | 50 | STABLE |
| 6 (RESTAKING) | 50 | STABLE |
| 7–10 | 50 | STABLE |

**All narrative snapshots have health = 50** (SNAPSHOT_NEUTRAL_SCORE).

### 2.5 Legacy Health Scores (P3 System)

| Coin | Health Score | Status |
|------|-------------|--------|
| 1 | 48.1 | WEAK |
| 4 | 55.1 | CAUTION |
| 5 | 47.5 | WEAK |
| 6 | 43.4 | WEAK |
| 10 | 32.1 | WEAK |
| 11 | 25.9 | WEAK |
| 12 | 54.5 | CAUTION |
| 15 | 36.3 | WEAK |
| 16 | 26.8 | WEAK |
| 17 | 65.2 | NEUTRAL |

**The legacy health system produces real scores.** P6 coin snapshots also produce real scores. The gap is narrative aggregation.

---

## 3. End-to-End Pipeline Trace

### Stage 1: Market Data → Indicators

**INPUT:** `market_price_daily` (OHLCV data)
**OUTPUT:** `indicators` table (EMA_9, RSI_14, MACD, VOLUME_RATIO, etc.)
**SOURCE:** Binance API during refresh
**NULL HANDLING:** Indicators computed only when sufficient history exists
**STATUS:** ✅ WORKING — indicators are populated for all active coins

### Stage 2: Indicators → Features (P6-02)

**INPUT:** `indicators` table
**OUTPUT:** `features` table (trend_score, momentum_score, volume_score, derivative_score)
**SOURCE:** P6-02 feature computation engine
**TRANSFORMATION:** Each dimension scored 0–100 based on weighted indicator analysis
**NULL HANDLING:** Falls back to SNAPSHOT_NEUTRAL_SCORE if indicators missing
**STATUS:** ✅ WORKING — 1123 rows, zero NULL scores

### Stage 3: Features → Coin Snapshots (P6-03D)

**INPUT:** `CoinSnapshotInput` (health_score, trend_score, etc.)
**OUTPUT:** `p6_snapshots` with entity_type = 'coin'
**SOURCE:** `generateCoinSnapshot()` in coin-snapshot.ts
**TRANSFORMATION:** Pass-through of health_score + dimension metadata
**NULL HANDLING:** Individual dimensions use ?? SNAPSHOT_NEUTRAL_SCORE, but health_score is passed directly
**STATUS:** ✅ WORKING — coin snapshots have real scores (25.88–79.38)

### Stage 4: Coin Snapshots → Narrative Snapshots (P6-03D) ← **BREAKDOWN HERE**

**INPUT:** `CoinSnapshotInput` assembled in service.ts
**OUTPUT:** `p6_snapshots` with entity_type = 'narrative'
**SOURCE:** `generateNarrativeSnapshot()` → `computeNarrativeHealthScore()`
**TRANSFORMATION:** Market-cap weighted average of coin health scores
**STATUS:** ❌ **BROKEN — market_cap is hardcoded to null**

### Stage 5: Narrative Snapshots → P6 Regime

**INPUT:** narrative health_score from p6_snapshots
**OUTPUT:** `p6_regime_states` with regime_state
**SOURCE:** State machine: 40 ≤ score ≤ 60 → STABLE
**STATUS:** ⚠️ DEGRADED — inputs always 50, output always STABLE

---

## 4. Earliest Failure Point

**File:** `src/lib/p6/snapshot/service.ts`, lines 105-120

```typescript
// Line 108: member without snapshot
market_cap: null,

// Line 118: member WITH snapshot  
market_cap: null,
```

Both branches of the coin snapshot lookup hardcode `market_cap: null`.

**File:** `src/lib/p6/snapshot/narrative-snapshot.ts`, lines 40-42

```typescript
const usableMembers = sorted.filter(
  (m) => m.market_cap !== null && m.market_cap > 0
);
```

Since `market_cap` is always null → `usableMembers.length === 0` → return `SNAPSHOT_NEUTRAL_SCORE` (50).

**This is the single point of failure.** All downstream behavior (narrative health = 50, regime = STABLE) follows deterministically.

---

## 5. Root Cause Classification

**Classification:** `H — feature generation not connected to refresh`

More precisely: the narrative snapshot service assembles `CoinSnapshotInput` with `market_cap: null` instead of reading from the available `coin_metrics.market_cap` data. The feature scores are correctly computed and persisted at the coin level, but the narrative aggregation step lacks the weighting data needed to produce a meaningful narrative health score.

**Not a bug in the feature pipeline.** The feature pipeline produces correct, non-NULL scores.
**Not a data availability issue.** The `coin_metrics` table has `market_cap` data.
**A wiring gap** between coin metrics and the narrative snapshot assembly.

---

## 6. Configuration Interaction

The health_weights configuration:

```json
{
  "trend": 0.35,
  "volume": 0.20,
  "momentum": 0.10,
  "derivative": 0.35
}
```

These weights are used by the **coin-level** health score computation (P6-02 feature calculation), NOT by the narrative aggregation. The narrative aggregation only reads `health_score` from each coin snapshot.

**Current effective influence:** The weights ARE being applied at the coin level — coin health scores vary from 25.88 to 79.38, not uniformly 50. The weights are functional but their effect is invisible at the narrative level due to the market_cap null issue.

**P6-SEMANTIC-01 recommendation (derivative 0.35 → 0.30):**
- **DEFER** — weights are correctly applied at coin level, but the narrative-level effect is masked. Tune after market_cap is fixed and narrative health becomes responsive.

---

## 7. P3 vs P6 Comparison

| Aspect | P3 | P6 |
|--------|----|----|
| Data source | P3 narrative intelligence (momentum, rotation, breadth) | P6 feature scores (trend, momentum, volume, derivative) |
| Calculation | Narrative-level from constituent data | Coin-level → market-cap weighted narrative average |
| Health score | Not applicable (uses regime/rotation) | 0–100 composite |
| Current state | Working (regime/rotation populated) | Coin: Working; Narrative: Broken (50) |
| market_cap dependency | None | Critical — currently null |

P3 and P6 use fundamentally different approaches:
- P3 computes narrative intelligence directly from coin-level momentum/breadth/rotation data
- P6 computes coin health first, then aggregates to narrative using market-cap weighting

P3's independence from market_cap explains why P3 produces meaningful regime/rotation classifications while P6 narratives are stuck at neutral.

---

## 8. Coin → Narrative Aggregation

### How it should work:

1. Each coin gets a health score from P6-02 feature computation
2. Each coin's health is weighted by its market cap
3. Narrative health = sum(coin_health × market_cap) / sum(market_cap)
4. Coins without market cap data are excluded (not assigned invented health)

### How it actually works:

1. Each coin gets a health score ✅
2. `market_cap` is hardcoded to null for all coins ❌
3. `usableMembers` filter: market_cap !== null && market_cap > 0 → 0 coins pass
4. `usableMembers.length === 0` → return SNAPSHOT_NEUTRAL_SCORE (50)

---

## 9. Missing Data Semantics

### Derivative Special Case

The derivative feature score IS populated for most coins (derivative_null_count = 0 in the 30-day aggregate). However, some coins have `missing: ["LIQUIDATION"]` in their source_provenance. The feature engine correctly handles this by computing derivative from available indicators (OI_CHANGE, FUNDING_RATE) and marking unavailable sub-components in provenance metadata.

**Derivative NULL is NOT the problem.** The root cause is upstream of derivative computation.

### Market Cap Semantics

Per the narrative snapshot contract (PD-03B-12):
> "Members without usable snapshot are EXCLUDED, not assigned invented health."

The current behavior (hardcoded null) makes ALL members excluded, which is correct per the contract when data is truly unavailable. The issue is that data IS available (in `coin_metrics.market_cap`) but is not wired through.

---

## 10. Quantitative Impact

| Metric | Current | If market_cap Wired |
|--------|---------|---------------------|
| Narratives affected | 100% (all 9) | N/A — fix affects all |
| Coin snapshots with real health | 100% (49 coins) | Unchanged |
| Narrative health distribution | 100% at 50 | Would vary based on coin health × market cap |
| P6 Regime distribution | 100% STABLE | Would vary (STRONG/STABLE/WEAK) |
| P6 warnings | 0 | Would generate when regime changes |

### Expected Post-Fix Behavior

If market_cap is wired from coin_metrics:
- Coin health scores (25.88–79.38) would be weighted by market cap
- Narratives with high-cap, healthy coins → health > 60 (STRONG regime)
- Narratives with low-cap, weak coins → health < 40 (WEAK regime)
- Mixed narratives → health in 40–60 range (STABLE)
- P6 warnings would fire on regime transitions
- P6 health would finally differentiate between narratives

---

## 11. Frozen Boundary Verification

| Boundary | Violated? | Evidence |
|----------|-----------|----------|
| P3 semantics unchanged | ❌ No | P3 untouched |
| P4 semantics unchanged | ❌ No | P4 untouched |
| P5 semantics unchanged | ❌ No | P5 untouched |
| P6 snapshot contract preserved | ❌ No | Neutral fallback is per design |
| P6 feature computation unchanged | ❌ No | Feature scores correctly computed |
| P6 narrative aggregation contract | ❌ No | Market-cap weighting is the intended design |

---

## 12. Recommended Repair Scope

**Smallest correct fix:** Wire `market_cap` from `coin_metrics` table into the narrative snapshot assembly in `src/lib/p6/snapshot/service.ts`.

**Specific changes required:**
1. In `service.ts`, when assembling narrative member inputs, query `coin_metrics.market_cap` for each coin
2. Pass the actual market_cap value instead of `null`

**NOT required:**
- Feature pipeline changes (already working)
- P6-02 changes (already working)
- Coin snapshot changes (already working)
- Schema changes (market_cap column exists in coin_metrics)
- Migration changes (no new tables/columns needed)

---

## 13. Evidence Gaps

| Gap | Impact | Priority |
|-----|--------|----------|
| Unknown whether coin_metrics.market_cap is populated for all coins | Could affect partial fix | MEDIUM |
| Unknown refresh pipeline market_cap update frequency | May need market_cap refresh coordination | LOW |
| P6-SEMANTIC-02 report contained incorrect root cause | Previous report should be updated | LOW |

---

## 14. Max Hypothesis Cross-Check (Re-evaluation)

| Max Hypothesis | Re-evaluation | Verdict |
|---------------|---------------|---------|
| derivative too high | Feature scores are all populated. Derivative contributes at coin level. Narrative effect masked by market_cap issue. | **INSUFFICIENT EVIDENCE** — tune after fix |
| momentum too low | Feature scores are all populated. Momentum contributes at coin level. | **INSUFFICIENT EVIDENCE** — tune after fix |
| derivative missing-data problem | Derivative IS computed from OI_CHANGE + FUNDING_RATE. LIQUIDATION is sometimes missing but doesn't cause NULL. | **NOT SUPPORTED** — derivative is not the issue |
| dynamic weighting | Not relevant to current root cause. | **DEFER** |

---

## 15. Next Task Recommendation

```
NEXT_TASK = P6-SEMANTIC-04 — Wire market_cap into P6 Narrative Snapshot Aggregation
```

**Justification:** The root cause is a single wiring gap in `src/lib/p6/snapshot/service.ts` where `market_cap` is hardcoded to `null`. The fix is minimal, bounded, and does not affect any frozen contracts. After this fix, P6 narrative health will finally reflect actual coin health distributions, enabling meaningful P6 regime differentiation and warnings.

---

## 16. Final Verdict

```
FEATURE PIPELINE HEALTHY — NARRATIVE AGGREGATION WIRING GAP
```

The P6 feature pipeline (P6-02) is healthy — all feature scores are computed and persisted correctly. The coin-level P6 snapshots produce real, varied health scores. The failure is in the narrative aggregation step where `market_cap` data is not wired from the available `coin_metrics` table, causing all narratives to receive the neutral fallback score of 50.
