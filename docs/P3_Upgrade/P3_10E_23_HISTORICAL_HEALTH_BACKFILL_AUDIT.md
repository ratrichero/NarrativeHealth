# P3-10E.23 — Historical Narrative Health Backfill Feasibility & Controlled Replay Audit

## 1. Executive Summary

P3-10E.23 is a **READ-ONLY audit** to determine whether the canonical P0-P2 health pipeline can be replayed to backfill missing `narrative_health` records for 2026-07-28 through 2026-07-31.

**STATUS: BLOCKED**

The audit identified four hard blockers that prevent canonical replay:

1. **Historical membership undetermined** — `coin_narratives` has changed since the missing dates, and no audit/history table exists.
2. **Data inconsistency** — Existing `narrative_health` for 2026-08-01 references coins (2, 3) that no longer exist in the `coins` table.
3. **Missing `health_scores`** — No per-coin health scores exist for 2026-07-28 to 2026-07-30.
4. **Missing `coin_metrics`** — No OI, funding rate, or FDV data exists for 2026-07-28 to 2026-07-30.

## 2. Current `narrative_health` Coverage

| Date | health_score | coin_count | weighting_method | rule_version_id |
|---|---|---|---|---|
| 2026-08-01 | 30.82 | 6 | equal | 1 |
| 2026-08-02 | 33.60 | 7 | equal | 1 |
| 2026-08-03 | 32.70 | 7 | equal | 1 |
| 2026-08-04 | 31.34 | 7 | equal | 1 |
| 2026-08-05 | 32.21 | 7 | equal | 1 |
| 2026-08-06 | 38.59 | 7 | market_cap | 1 |
| 2026-08-07 | 43.06 | 7 | equal | 1 |
| 2026-08-08 | 47.57 | 7 | equal | 1 |
| 2026-08-09 | 48.04 | 7 | equal | 1 |
| 2026-08-10 | 46.73 | 7 | equal | 1 |
| 2026-08-11 | 44.37 | 7 | equal | 1 |

**Existing range:** 2026-08-01 to 2026-08-11 (11 records)

**Missing dates:** 2026-07-28, 2026-07-29, 2026-07-30, 2026-07-31 (4 dates)

## 3. Missing Dates

| Date | narrative_health | health_scores | features | coin_metrics | market_price_daily |
|---|---|---|---|---|---|
| 2026-07-28 | MISSING | 0 | 0 | 0 | 7 records |
| 2026-07-29 | MISSING | 0 | 0 | 0 | 7 records |
| 2026-07-30 | MISSING | 0 | 0 | 0 | 7 records |
| 2026-07-31 | MISSING | 4 | 4 | 8 | 7 records |

## 4. Canonical P0-P2 Health Pipeline

### Entry Point

**Primary:** `src/app/api/refresh/route.ts` (Next.js API route)
**Secondary:** `backend/api/refresh.py` (FastAPI route)

### Per-Coin Pipeline

1. **Collect price data** (Binance futures/spot) → `market_price_daily`
2. **Collect OI + funding rate** (Binance futures) → `coin_metrics` (source=binance_futures)
3. **Collect FDV** (CoinGecko) → `coin_metrics` (source=coingecko)
4. **Run FeatureEngine.run():**
   - `trend_score` (linear regression on price)
   - `derivative_score` (OI change + funding rate)
   - `volume_score` (volume profile)
   - `momentum_score` (price momentum)
   - `confidence_score` (data completeness)
   → `features` table
5. **Calculate health_score:**
   ```
   health = trend * 0.35 + derivative * 0.35 + volume * 0.20 + momentum * 0.10
   ```
   → `health_scores` table

### Narrative Health Pipeline

1. Get active narratives
2. For each narrative:
   a. Get coins from `coin_narratives` (**CURRENT membership**)
   b. Get `health_scores` for `today`
   c. Get `market_cap` from `coin_metrics` for `today`
   d. Get previous `narrative_health` (`yesterday`)
   e. Run `calculateWeightedNarrativeHealth()`:
      - If any coin missing `market_cap` → equal weighting
      - Else → market cap weighting
      - `weightedHealth = sum(coin.healthScore * weight)`
   f. Save to `narrative_health`

### Configuration Dependencies

- `health_weights`: `{trend: 0.35, derivative: 0.35, volume: 0.20, momentum: 0.10}`
- `confidence_weights`: `{binance_spot: 0.30, binance_futures: 0.40, coingecko: 0.30}`
- `recommendation_thresholds`: `{strong_watch: 90, watch: 80, observe: 65}`
- Rule version: loaded from `rule_versions` table (active version)

## 5. Dependency Graph

```
Binance API / CoinGecko API
        ↓
market_price_daily (OHLCV)
coin_metrics (OI, funding, FDV)
        ↓
FeatureEngine.run()
        ↓
features (trend, derivative, volume, momentum, confidence)
        ↓
calculate_health_score()
        ↓
health_scores
        ↓
calculateWeightedNarrativeHealth()
        ↓
narrative_health
```

**Critical dependencies for replay:**
- `coin_narratives` (CURRENT membership — no historical tracking)
- `coins` (must exist)
- `market_price_daily` (historical available)
- `coin_metrics` (OI, funding, FDV — LIMITED historical)
- `health_scores` (NOT available for 2026-07-28 to 2026-07-30)
- `features` (NOT available for 2026-07-28 to 2026-07-30)
- `narrative_health` (previous day for `score_change`)

## 6. Configuration Dependencies

| Config | Source | Current Value |
|---|---|---|
| `health_weights` | `rule_versions` (active) or `score_configs` | `{trend: 0.35, derivative: 0.35, volume: 0.20, momentum: 0.10}` |
| `confidence_weights` | `FeatureEngine` default | `{binance_spot: 0.30, binance_futures: 0.40, coingecko: 0.30}` |
| `recommendation_thresholds` | `FeatureEngine` default | `{strong_watch: 90, watch: 80, observe: 65}` |
| `rule_version_id` | `rule_versions` (active) | 1 |

## 7. Historical Membership Semantics

### Current Membership (2026-08-11)

| coin_id | symbol | created_at |
|---|---|---|
| 1 | CARV | 2026-07-31 12:47:20 |
| 4 | FET | 2026-07-31 12:47:20 |
| 5 | RENDER | 2026-07-31 12:47:20 |
| 10 | BLUAI | 2026-07-31 16:37:19 |
| 11 | AKT | 2026-08-02 13:30:14 |
| 12 | PROMPT | 2026-08-02 14:08:21 |
| 22 | TRUTH | 2026-08-02 14:15:28 |

### Historical Membership (from `narrative_health` coin_breakdown)

| Date | coins in breakdown | coin_count |
|---|---|---|
| 2026-08-01 | 1, 2, 3, 4, 5, 10 | 6 |
| 2026-08-02 | 1, 4, 5, 10, 11, 12, 22 | 7 |

### Critical Finding

- Coins **2** and **3** appear in `narrative_health` for 2026-08-01 but **do not exist** in the current `coins` table.
- Coins 2 and 3 were removed from `coin_narratives` at some point between 2026-08-01 and 2026-08-02.
- **No audit/history table exists** for `coin_narratives` changes.
- Historical membership for 2026-07-28 to 2026-07-31 **CANNOT be determined authoritatively**.

## 8. Source Data Availability

### Market Prices (`market_price_daily`)

Available for all 7 AI coins for all 4 missing dates. ✅

### Coin Metrics (`coin_metrics`)

| Date | Records | Sources | OI | Funding | FDV |
|---|---|---|---|---|---|
| 2026-07-28 | 0 | — | — | — | — |
| 2026-07-29 | 0 | — | — | — | — |
| 2026-07-30 | 0 | — | — | — | — |
| 2026-07-31 | 8 | binance_futures + coingecko | Partial | Partial | Partial |

### Health Scores (`health_scores`)

| Date | Records | Coins |
|---|---|---|
| 2026-07-28 | 0 | — |
| 2026-07-29 | 0 | — |
| 2026-07-30 | 0 | — |
| 2026-07-31 | 4 | 1, 4, 5, 10 |

### Features (`features`)

| Date | Records |
|---|---|
| 2026-07-28 | 0 |
| 2026-07-29 | 0 |
| 2026-07-30 | 0 |
| 2026-07-31 | 4 |

## 9. Dry-Run Replay Results

**No dry-run was performed** because the preconditions for replay are not met:

1. **Historical membership unknown** — Cannot determine which coins to include in the calculation.
2. **Missing `health_scores`** — Cannot run `calculateWeightedNarrativeHealth()` without per-coin health scores.
3. **Missing `coin_metrics`** — Cannot calculate `derivative_score` without OI/funding data.
4. **Missing market cap** — `calculateWeightedNarrativeHealth()` requires market cap data, which is absent for 2026-07-28 to 2026-07-30.

## 10. Forward Consistency Results

**FAIL**

Attempted to reproduce `narrative_health` for 2026-08-01 using current system state:

| Metric | Expected (existing) | Actual (current) |
|---|---|---|
| `coin_count` | 6 | 4 |
| `coins` | 1, 2, 3, 4, 5, 10 | 1, 4, 5, 10 |
| `health_score` | 30.82 | 30.89 (4-coin avg) |
| `weighting_method` | equal | equal |

**Divergence:** Current membership has 4 coins with health scores for 2026-08-01. Existing `narrative_health` has 6 coins, including coins 2 and 3 which no longer exist.

## 11. Determinism Results

**Not applicable** — Dry-run could not be performed due to missing preconditions.

## 12. Production Safety Verification

| Table | Before Audit | After Audit | Change |
|---|---|---|---|
| `narrative_health` | 46 | 46 | 0 |
| `health_scores` | 232 | 232 | 0 |
| `features` | 232 | 232 | 0 |
| `market_price_daily` | 5100 | 5100 | 0 |
| `coin_metrics` | 464 | 464 | 0 |
| `coin_narratives` | 25 | 25 | 0 |

**Production writes:** 0
**Production mutations:** 0

## 13. Backfill Feasibility Decision

### STATUS: BLOCKED

### Blockers

| # | Blocker | Severity | Unblockable Without |
|---|---|---|---|
| 1 | Historical membership undetermined | HARD | Audit table for `coin_narratives` changes |
| 2 | Data inconsistency (coins 2, 3 deleted) | HARD | Restoring coins 2, 3 or accepting data loss |
| 3 | Missing `health_scores` for 2026-07-28 to 2026-07-30 | HARD | Running full per-coin feature pipeline |
| 4 | Missing `coin_metrics` for 2026-07-28 to 2026-07-30 | HARD | Re-collecting OI/funding/FDV from external APIs |

### What Is Feasible

- **2026-07-31 (partial):** If membership is confirmed as coins 1, 4, 5, 10:
  - `health_scores` exist for these 4 coins
  - `coin_metrics` has partial OI/funding data
  - `market_price_daily` has price data
  - But: market cap is missing (required for weighted calculation)
  - But: cannot forward-consistently reproduce existing `narrative_health`
  - But: coins 2, 3 may have been in the narrative (unknown)

- **2026-07-28 to 2026-07-30:** NOT feasible
  - No `health_scores`
  - No `coin_metrics`
  - Unknown membership

## 14. Recommended Next Step

**Do NOT perform production backfill.**

Instead:

1. **Establish historical membership tracking** — Add audit table for `coin_narratives` changes with `created_at`, `updated_at`, `deleted_at`, and `changed_by`.
2. **Investigate coins 2, 3 deletion** — Determine why they were removed and whether their data can be restored.
3. **Update P3-05 contract** — If coins 2, 3 are permanently removed, P3-05 must accept partial narrative coverage (not all historical dates need full membership).
4. **Re-run E.23** — After historical membership is established and data inconsistencies are resolved.

## 15. Acceptance Criteria

| Criterion | Status |
|---|---|
| Missing historical dates identified exactly | ✅ PASS |
| Canonical P0-P2 health pipeline identified | ✅ PASS |
| All required source dependencies identified | ✅ PASS |
| Configuration dependencies verified | ✅ PASS |
| Historical membership semantics verified | ✅ FAIL — undetermined |
| Historical source data audited | ✅ PASS |
| Dry-run replay completed without production writes | ❌ BLOCKED — preconditions not met |
| Replay is deterministic | N/A — not performed |
| At least one existing production date successfully reproduced | ❌ FAIL — forward consistency failed |
| No P0-P2 code modified | ✅ PASS |
| No P3 code modified | ✅ PASS |
| No production mutation | ✅ PASS |
| Typecheck PASS | N/A — no code changes |
| git diff --check PASS | N/A — no code changes |
| Documentation complete | ✅ PASS |
| Clear FEASIBLE / PARTIALLY FEASIBLE / BLOCKED decision | ✅ BLOCKED |
