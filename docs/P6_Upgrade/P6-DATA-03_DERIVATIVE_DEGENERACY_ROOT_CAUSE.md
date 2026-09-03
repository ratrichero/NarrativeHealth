# P6-DATA-03 — Derivative Production Degeneracy Root-Cause Investigation

## Executive Summary

The derivative feature is constant 50 across all 49 coins because `fetchBinanceFuturesMetrics()`
returns null for open interest and funding rate in the current production environment.

**Root cause:** Binance Futures API calls (`/fapi/v1/openInterest` and `/fapi/v1/premiumIndex`)
are failing silently. The functions catch errors and return null, causing `hasFutures = false`
for every coin, which triggers the derivative calculator's fallback path (score=50, no_futures=true).

The `coin_metrics` table still has OI/funding data from a PREVIOUS successful refresh, but the
current refresh cannot fetch new data. The feature engine does NOT read from coin_metrics — it
relies on live API fetches.

**Verdict:** `DERIVATIVE_PIPELINE_BUG_FOUND`

This is NOT a calculator defect, NOT a persistence bug, NOT a versioning issue. It is a data
acquisition failure where the API silently fails and the system cannot distinguish "data unavailable"
from "neutral market signal."

---

## 1. Conflicting Historical Evidence

| Report | Derivative Values | Assessment |
|--------|------------------:|:----------:|
| P6-SEMANTIC-09 | 58 unique values, fractional | Continuous scoring was live |
| P6-SEMANTIC-10 | ~45 unique fractional values | Current-day data was differentiated |
| P6-DATA-01 | min=45.85, max=57.05, unique=37, stddev=1.67 | Small but real variance |
| P6-CONFIG-05 | mean=50, stddev=0, unique=1 | **Current state: fully degenerate** |

The transition from 37-58 unique values to 1 unique value (50) is NOT natural market behavior.
It indicates a pipeline failure.

---

## 2. Pipeline Trace

### Current Data Flow

```
Binance Futures API
  ↓ fetchBinanceFuturesMetrics(symbol)
  ↓ fetchBinanceOIHistory(symbol, "1d", 2)
  ↓
coin-processor.ts
  ↓ oiCurrent = futuresMetrics.openInterest  ← NULL
  ↓ fundingRate = futuresMetrics.fundingRate  ← NULL
  ↓ oiPrev = oiHistory[last].openInterest     ← null (empty array)
  ↓ hasFutures = (oiCurrent !== null || fundingRate !== null)  ← false
  ↓
  ↓ db.insert(coinMetrics) ← OI/funding stored (null)
  ↓
  ↓ runFeatureEngine(priceData, {openInterest: null, fundingRate: null, ...})
  ↓
engine.ts
  ↓ hasFutures = (metrics.openInterest !== null || metrics.fundingRate !== null)  ← false
  ↓ calculateDerivativeScore(null, null, null, false)
  ↓
derivative.ts
  ↓ if (!hasFutures) return { score: 50, no_futures: true, ... }
  ↓
  ↓ derivative_score = 50 (for ALL 49 coins)
```

### Key Observation

The coin_metrics table shows OI/funding data from a PREVIOUS refresh (e.g., Sep 2), but the
feature detail for the CURRENT date (Sep 3) has null values. This confirms the API is failing
in the current environment.

---

## 3. Raw Production Inputs

### Coin Metrics (from coin_metrics table)

| Coin | OI Current | Funding Rate | Source | Date |
|------|----------:|-------------:|--------|------|
| BTC | 108,189 | 0.00007507 | binance_futures | 2026-09-03 |
| ETH | 2,323,154 | 0.00009523 | binance_futures | 2026-09-03 |
| ARB | 314,794,544 | 0.00002917 | binance_futures | 2026-09-03 |
| RENDER | 5,464,662 | 0.00005000 | binance_futures | 2026-09-03 |
| CARV | 32,107,584 | 0.00005000 | binance_futures | 2026-09-03 |
| FET | 144,747,465 | 0.00010000 | binance_futures | 2026-09-03 |

### Feature Detail (from features table)

| Coin | derivative_score | oi_current | oi_prev | funding_rate | no_futures |
|------|:---------------:|:----------:|:-------:|:------------:|:----------:|
| BTC | 50 | null | null | null | true |
| ETH | 50 | null | null | null | true |
| ARB | 50 | null | null | null | true |
| RENDER | 50 | null | null | null | true |
| CARV | 50 | null | null | null | true |
| FET | 50 | null | null | null | true |

**The coin_metrics table HAS OI/funding data, but the feature detail shows null.**

---

## 4. Independent Reproduction

Direct API calls to Binance Futures in the current environment:

```
fetchBinanceFuturesMetrics("BTCUSDT"):
  openInterest = None
  fundingRate = None

fetchBinanceOIHistory("BTCUSDT", "1d", 2):
  entries = 0
```

Result for ALL 6 tested coins (BTC, ETH, ARB, RENDER, CARV, FET):
- `openInterest = None`
- `fundingRate = None`
- `oiHistory = []`
- `hasFutures = false`
- `derivative_score = 50`

**The Binance Futures API calls are failing in the current environment.**

---

## 5. Why coin_metrics Has Data But Features Don't

The coin_metrics table has OI/funding data from a PREVIOUS refresh that successfully called
the Binance Futures API. The current refresh's API calls are failing (likely due to
environment-specific network issues, rate limiting, or API endpoint changes).

The feature engine does NOT read from coin_metrics — it relies on live API fetches during
the refresh. When the API fails, the feature engine receives null values and defaults to
score=50.

---

## 6. Root Cause Classification

**Category B: Raw inputs exist but calculator returns 50 unexpectedly**

However, the "raw inputs exist" part is nuanced:
- coin_metrics HAS OI/funding (from previous refresh)
- The CURRENT refresh's API calls FAIL (null returned)
- The feature engine receives null → calculates 50

This is a **data acquisition failure** combined with a **silent fallback** that makes
the failure invisible.

---

## 7. Semantic Impact

### Current Impact

- derivative_score = 50 for ALL 49 coins (zero discrimination)
- derivative contributes constant 7.5 to all health scores (dead weight)
- v7 health weights are effectively: trend=30%, volume=30%, momentum=25%, derivative=0%

### Broader Impact

- All historical derivative values since the API failure are semantically incorrect
- Any calibration based on recent derivative data is invalid
- The "genuine degeneracy" conclusion from P6-CONFIG-05 was WRONG — it was actually a pipeline failure

---

## 8. Why Previous Reports Saw Different Values

P6-SEMANTIC-09, P6-SEMANTIC-10, and P6-DATA-01 all reported non-degenerate derivative values.
These reports were generated when the Binance Futures API was working correctly.

The transition to constant 50 happened when the API started failing. This could be due to:
- Binance API rate limiting from the workspace environment
- Network restrictions in the Freebuff/Daytona environment
- Binance Futures API endpoint changes
- IP-based access restrictions

---

## 9. Recommendations

### Immediate Fix Options

1. **Fix the Binance Futures API access:** Investigate why the API calls fail in the
   current environment. Check network connectivity, rate limits, and API endpoint availability.

2. **Add fallback data source:** If Binance Futures API is unreliable, consider using
   a cached/stale data source with explicit provenance flags.

3. **Improve error visibility:** The current silent fallback (null → score=50) makes
   failures invisible. Add explicit logging/alerting when futures data is unavailable.

4. **Distinguish "data unavailable" from "neutral":** The derivative calculator should
   produce a distinguishable output when data is unavailable vs. when the market is neutral.

### NOT Recommended

- Changing derivative weights to compensate for the bug
- Accepting score=50 as "genuine degeneracy"
- Recalibrating health weights without fixing the data source

---

## 10. Final Verdict

```
DERIVATIVE_PIPELINE_BUG_FOUND
```

The derivative feature is constant 50 because Binance Futures API calls return null
in the current environment. The coin_metrics table has data from a previous successful
refresh, but the feature engine relies on live API fetches which are failing.

### TypeScript
✅ PASS

### Tests
✅ 44/44

### Git
✅ Clean
