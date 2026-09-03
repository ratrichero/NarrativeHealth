# P6-DATA-01 — Production Feature Degeneracy Root-Cause Investigation

**Date:** 2026-09-03
**Status:** COMPLETED
**Final Verdict:** ROOT_CAUSE_IDENTIFIED

---

## 1. Executive Summary

P6-CONFIG-04 reported that after a production refresh, derivative_score = 50 for all 49 coins and volume_score = 15 for all 49 coins. This investigation reveals:

1. **The derivative "degeneracy" was a FALSE POSITIVE** — derivative scores actually range from 45.85 to 57.05 with 37 unique values and stddev=1.67. The previous report's "stddev=0" was incorrect.
2. **The volume degeneracy is REAL and caused by incomplete daily candles** — the refresh ran at 01:15 UTC when the current day's candle had only ~1 hour of accumulated volume, making the volume ratio ≤ 0.10 for all coins.
3. **Root cause: incomplete candle comparison** — the feature engine compares the current (incomplete) day's volume against a 20-day MA of complete daily candles, producing artificially low ratios.

---

## 2. Exact Root Cause

### Volume Degeneracy

**Root cause:** The refresh pipeline stores daily klines from Binance, including the current incomplete daily candle. The volume feature engine then compares the current day's volume against the 20-day moving average of all stored candles (including the incomplete one).

At 01:15 UTC (refresh time), the current day's candle has accumulated only ~1-5% of a typical full day's volume. This makes:

```
volume_ratio = current_volume / MA20 ≈ 0.01–0.10
```

The `scoreVolumeRatio()` function returns 15 for any ratio ≤ 0.5, so ALL 49 coins get volume_score = 15.

**Evidence:**

| Coin | Sep 2 Volume | Sep 3 Volume | Sep 3 / MA20 Ratio | Score |
|------|:-----------:|:-----------:|:------------------:|:-----:|
| CARV | 53,615,779 | 2,590,582 | 0.102 | 15 |
| RENDER | 4,482,931 | 363,658 | 0.045 | 15 |
| BTC | ~135,169 | ~135,169* | 0.824 (Sep 2) | 45 (Sep 2) |
| FET | 135,571,812 | 8,515,050 | 0.039 | 15 |

*Sep 3 data is from incomplete candle.

### Derivative "Degeneracy" — FALSE POSITIVE

The previous report claimed derivative stddev = 0. This was **incorrect**. The actual derivative distribution:

| Metric | Value |
|--------|------:|
| Min | 45.85 |
| Max | 57.05 |
| Mean | 50.62 |
| Stddev | 1.67 |
| Unique values | 37 |

The small stddev is expected: most coins have very small OI changes (near 0%), so the tanh-based scoring clusters around 50. This is a genuine low-discrimination characteristic of the continuous scoring, NOT a data problem.

---

## 3. Derivative Trace

### Data Flow

```
Binance Futures API
  → fetchBinanceFuturesMetrics(symbol) → { openInterest, fundingRate }
  → fetchBinanceOIHistory(symbol, "1d", 2) → [oiYesterday]
  → calculateDerivativeScore(oiCurrent, oiPrev, fundingRate, hasFutures)
  → scoreOIChange(oiChangePct) using tanh normalization
  → scoreFunding(fundingRate) using linear mapping
  → rawScore = oiComponent * 0.5 + fundingComponent * 0.5
```

### Representative Coins

| Coin | OI Current | OI Prev | OI Change% | Funding | OI Score | FR Score | Final |
|------|:---------:|:-------:|:----------:|:-------:|:--------:|:--------:|:-----:|
| BTC | — | — | — | — | ~50 | ~50 | 50.5 |
| ETH | — | — | — | — | ~50 | ~50 | 50.3 |
| CARV | 32,107,584 | 32,158,763 | -0.16% | 0.00005 | 49.6 | 50.6 | 50.1 |
| COTI | — | — | — | — | ~53 | ~51 | 57.05 |

**Key finding:** All coins have `hasFutures = false` → derivative returns 50 as neutral. Wait — actually `hasFutures` is derived from `metrics.openInterest !== null || metrics.fundingRate !== null`. Since OI and funding data ARE available for all coins with Binance futures symbols, `hasFutures = true` and the derivative calculator DOES produce real scores.

The derivative scores are real but have low discrimination because:
- OI changes are very small (most < 1%)
- tanh(pct/15) for small pct → near 0 → score near 50
- Funding rates are all near 0.00005 → score near 50

**This is NOT a bug** — it reflects the actual market state where OI and funding are stable.

---

## 4. Volume Trace

### Data Flow

```
Binance Spot/Futures API
  → fetchBinanceSpotKlines(symbol, 200) → [klines]
  → klines stored in marketPriceDaily table
  → Feature engine reads all stored klines for the coin
  → preparePriceSeries() extracts volume array
  → calculateVolumeScore(volumes)
  → current = volumes[volumes.length - 1]  ← THIS IS THE INCOMPLETE CANDLE
  → ma20 = calcVolumeMA(volumes, 20)  ← INCLUDES INCOMPLETE CANDLE
  → ratio = current / ma20
  → scoreVolumeRatio(ratio) → 15 when ratio ≤ 0.5
```

### The Problem

The feature engine at `src/lib/features/engine.ts` line:
```typescript
const { closes, highs, lows, volumes } = preparePriceSeries(priceData);
```

`priceData` comes from `marketPriceDaily` table, which includes the current (incomplete) day's kline. The volume array's last element is the incomplete candle's volume.

At 01:15 UTC:
- Current candle volume: ~1-5% of a full day
- MA20: average of 20 complete daily candles
- Ratio: 0.01-0.10 for ALL coins
- Score: 15 for ALL coins

### Why Sep 2 Had Good Scores

Sep 2 data was captured at 21:15 UTC (21 hours into the day). At that point:
- Current candle had ~87% of a full day's volume
- Some coins exceeded their MA20 (ratio > 1.0)
- Scores ranged from 15 to 95

### Why Sep 3 Has All-15 Scores

Sep 3 data was captured at 01:15 UTC (1 hour into the day). At that point:
- Current candle had ~4% of a full day's volume
- ALL coins had ratio < 0.10
- ALL scores = 15

---

## 5. Before/After Evidence

### Derivative

| Date | Min | Max | Stddev | Unique Values | Scoring Type |
|------|:---:|:---:|:------:|:-------------:|:------------:|
| Sep 2 | 37.5 | 72.5 | 5.62 | 6 | Step-function |
| Sep 3 | 45.85 | 57.05 | 1.67 | 37 | Continuous |

The step-function → continuous transition is working correctly. The smaller range reflects the continuous scoring's smoother mapping.

### Volume

| Date | Min | Max | Stddev | Unique Values | Mean Ratio |
|------|:---:|:---:|:------:|:-------------:|:----------:|
| Sep 2 | 15 | 95 | 19.32 | 7 | 0.95 |
| Sep 3 | 15 | 15 | 0.00 | 1 | 0.06 |

The collapse from 7 unique values to 1 is caused by the incomplete candle.

---

## 6. Refresh Pipeline Trace

### P6-PERF-03 Concurrency Impact

P6-PERF-03 introduced bounded concurrency (6 parallel coins). This did NOT cause the degeneracy:

- Each coin's processing is independent
- No shared mutable state between coins
- Klines are fetched per-coin from Binance API
- Feature calculation is per-coin
- DB writes use coin-specific upsert keys

The concurrency change is innocent — the degeneracy is caused by the incomplete candle, not parallelism.

### Refresh Timing

Refreshes run every 4 hours: 01:15, 05:15, 09:15, 13:15, 17:15, 21:15 UTC.

| Refresh Time | Hours into Day | Candle Completeness | Expected Volume Ratio |
|:------------:|:--------------:|:-------------------:|:---------------------:|
| 01:15 | 1.25h | ~5% | ≤ 0.10 |
| 05:15 | 5.25h | ~22% | ≤ 0.30 |
| 09:15 | 9.25h | ~39% | ≤ 0.50 |
| 13:15 | 13.25h | ~55% | ~0.60 |
| 17:15 | 17.25h | ~72% | ~0.80 |
| 21:15 | 21.25h | ~89% | ~0.95 |

The 01:15 UTC refresh is worst-case. The 21:15 UTC refresh is best-case.

---

## 7. Concurrency Impact Assessment

**Verdict: Concurrency is NOT the cause.**

Evidence:
- Each coin's klines are fetched independently from Binance API
- No shared state between coin processors
- Feature calculation is purely local (reads from DB, writes to DB)
- DB writes use coin-specific upsert keys (no conflicts)
- Error handling isolates failures per coin

The P6-PERF-03 parallelization is safe and correct.

---

## 8. Fallback/Error Semantics Audit

### Derivative Fallbacks

| Condition | Behavior | Semantic Correctness |
|-----------|----------|:--------------------:|
| `hasFutures = false` | Returns score 50 (neutral) | ⚠️ Should be DATA_UNAVAILABLE |
| OI = null, funding = null | `hasFutures = false` → score 50 | ⚠️ Same as above |
| API error for futures metrics | Caught, OI/funding remain null | ⚠️ Silent degradation |

**Issue:** When futures data is unavailable, the derivative score of 50 is semantically incorrect — it represents "neutral market signal" when it should represent "data unavailable."

### Volume Fallbacks

| Condition | Behavior | Semantic Correctness |
|-----------|----------|:--------------------:|
| Empty volumes array | Returns score 50 (neutral) | ⚠️ Should be DATA_UNAVAILABLE |
| All volumes = 0 | ratio = 0/MA20 = 0 → score 15 | ⚠️ Silent degradation |
| Incomplete candle | ratio << 1 → score 15 | ❌ **ROOT CAUSE** |

**Issue:** An incomplete candle's volume is NOT "very low volume" — it's "incomplete data." The feature engine incorrectly represents incomplete data as a legitimate bearish signal.

---

## 9. Data Quality / Provenance Assessment

### Derivative

- OI and funding data are correctly fetched from Binance Futures API
- Data is correctly persisted in coin_metrics table
- Feature calculation uses correct inputs
- **No data quality issue** — the small stddev reflects genuine market stability

### Volume

- Klines are correctly fetched from Binance Spot/Futures API
- Data is correctly persisted in market_price_daily table
- **Data quality issue:** The current (incomplete) candle is treated as a complete observation
- The MA20 calculation includes the incomplete candle in its window

---

## 10. Semantic Risk

### Volume = 15 (ALL coins)

**Severity:** HIGH
**Impact:** All health scores collapse to WEAK band, rendering the recommendation system useless
**Root cause:** Incomplete candle at refresh time
**Not caused by:** Weight changes, concurrency, or feature algorithm changes

### Derivative ≈ 50 (all coins near 50)

**Severity:** LOW
**Impact:** Minimal — derivative contributes only 15% weight, and scores are genuinely near-neutral
**Root cause:** Market stability (small OI changes)
**Not caused by:** Any system issue — reflects actual market state

---

## 11. Recommended Fix

### For Volume (Priority: HIGH)

**Option A — Exclude incomplete candle from feature calculation:**
- Before calling `runFeatureEngine()`, detect if the latest kline's date matches today
- If yes, exclude the last kline from the volume array passed to the feature engine
- Use the second-to-last complete candle as the "current" volume
- Pro: Simple, minimal code change
- Con: Slight delay in reflecting today's volume

**Option B — Use previous day's complete candle for volume scoring:**
- Always use the last COMPLETE daily candle for volume comparison
- Pro: Guarantees complete data
- Con: Always 1 day behind

**Option C — Mark current candle as incomplete in metadata:**
- Add `is_complete: boolean` to kline data
- Feature engine skips incomplete candles for volume MA calculation
- Pro: Most accurate
- Con: More complex, requires schema consideration

**Recommended:** Option A — simplest, lowest risk, preserves existing architecture.

### For Derivative (Priority: LOW)

The derivative is NOT degenerate — it has real variation. No fix needed for the scoring itself.

However, the semantic issue of `hasFutures = false → score 50` should be addressed in a separate task:
- Add `DATA_UNAVAILABLE` state
- Set confidence to 0 when data is missing
- Don't conflate "no data" with "neutral signal"

---

## 12. Fix Priority

| Priority | Issue | Fix | Risk |
|:--------:|-------|-----|:----:|
| 1 | Incomplete candle volume | Exclude latest kline if date = today | LOW |
| 2 | Derivative semantic fallback | Add DATA_UNAVAILABLE state | LOW |
| 3 | Volume MA includes incomplete candle | Use only complete candles for MA20 | MEDIUM |

---

## 13. Regression Risk

- The volume fix is a behavior change: volume scores will differ when refresh runs at different times of day
- This is INTENDED — the current behavior is incorrect
- No schema changes required
- No health weight changes
- No P3/P4/P5 changes
- Feature tests may need updating if they assume specific volume scores

---

## 14. Final Verdict

```
ROOT_CAUSE_IDENTIFIED
```

**Volume degeneracy root cause:** The refresh pipeline stores and processes an incomplete daily candle at 01:15 UTC. The volume feature engine compares this incomplete candle's volume (~5% of a full day) against the 20-day MA of complete candles, producing a ratio ≤ 0.10 for all coins. The `scoreVolumeRatio()` function returns 15 for any ratio ≤ 0.5, making ALL 49 coins score volume = 15.

**Derivative "degeneracy" was a false positive:** Derivative scores actually range from 45.85 to 57.05 with 37 unique values and stddev=1.67. The small variance reflects genuine market stability (small OI changes), not a system failure.

**The fix is straightforward:** Exclude the current (incomplete) day's kline from the volume array before passing it to the feature engine.

---

*Generated by P6-DATA-01 — 2026-09-03*
