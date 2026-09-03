# P6-DATA-04 — Futures Data Availability & Derivative Degradation Contract

**Task:** P6-DATA-04  
**Status:** AUDIT COMPLETE — CONTRACT DEFINED  
**Depends on:** P6-DATA-03 (`9179576`)  
**Type:** Architecture / Contract Design  
**Code changes:** None  

---

## 1. Executive Summary

P6-DATA-03 established that the production derivative feature is constant 50 because Binance Futures API calls silently return `null` for all 49 coins. This document:

1. Traces the complete failure path from API → feature → health
2. Defines a semantic state model for futures data availability
3. Specifies score semantics, aggregation semantics, and confidence propagation
4. Documents the Binance failure investigation (ROOT_CAUSE_OF_BINANCE_ACCESS_FAILURE_UNRESOLVED)
5. Establishes an observability contract for source failures
6. Recommends implementation approach without implementing

**Final Verdict:** `DEGRADATION_CONTRACT_DEFINED`

---

## 2. Current Failure Path

### Pipeline Trace

```
Refresh (processSingleCoin)
  ↓
coin.binanceFuturesSymbol = "BTCUSDT" (coin has futures flag in DB)
  ↓
fetchBinanceFuturesMetrics("BTCUSDT")
  → Promise.all([
      fetchBinanceFuturesOI("BTCUSDT"),      → axios.get(fapi/...) → null (error caught)
      fetchBinanceFundingRate("BTCUSDT"),    → axios.get(fapi/...) → null (error caught)
    ])
  → { openInterest: null, fundingRate: null }
  ↓
oiCurrent = null
fundingRate = null
  ↓
fetchBinanceOIHistory("BTCUSDT", "1d", 2)
  → axios.get(futures/data/openInterestHist, ...) → [] (error caught)
  → oiHistory.length === 0 → oiPrev = null
  ↓
coinMetrics INSERT: { openInterest: null, fundingRate: null }
  ↓
runFeatureEngine(priceData, { openInterest: null, openInterestPrev: null, fundingRate: null }, ...)
  ↓
engine.ts: hasFutures = (null !== null) || (null !== null) = false
  ↓
calculateDerivativeScore(null, null, null, hasFutures=false)
  → return { score: 50, no_futures: true, ... }
  ↓
derivative_score = 50
derivative_detail = { no_futures: true, oi_current: null, oi_prev: null, ... }
  ↓
features INSERT: { derivativeScore: 50, derivativeDetail: { no_futures: true, ... } }
  ↓
healthScore = trend×0.30 + 50×0.15 + volume×0.30 + momentum×0.25
  → derivative contributes constant 7.5 to ALL coins
  → zero discrimination from derivative feature
```

### Silent Failure Chain

| Layer | Function | Failure | Handled? | Observable? |
|-------|----------|---------|:--------:|:-----------:|
| API | `fetchBinanceFuturesOI` | axios error → catch → return null | ✅ | ❌ |
| API | `fetchBinanceFundingRate` | axios error → catch → return null | ✅ | ❌ |
| API | `fetchBinanceOIHistory` | axios error → catch → return [] | ✅ | ❌ |
| Collector | `fetchBinanceFuturesMetrics` | propagates null | ✅ | ❌ |
| Processor | `processSingleCoin` | null → feature engine | ✅ | ❌ |
| Engine | `runFeatureEngine` | hasFutures=false → neutral 50 | ✅ | ❌ |
| Calculator | `calculateDerivativeScore` | score=50, no_futures=true | ✅ | ⚠️ detail only |
| Feature persistence | INSERT/UPDATE | stores no_futures=true in detail JSON | ✅ | ⚠️ |
| Health | `calculateHealthScore` | constant 50 × 0.15 = 7.5 | ✅ | ❌ |

**Every layer handles the failure correctly. The problem is that NO layer surfaces it as an operational concern.**

---

## 3. Semantic State Model

### Defined States

| State | Description | How Determined | Current Behavior |
|-------|-------------|----------------|:----------------:|
| `DERIVATIVE_AVAILABLE` | Sufficient futures data exists; calculation is meaningful | `hasFutures=true` AND OI+funding both present | ✅ Works |
| `DERIVATIVE_NOT_APPLICABLE` | Asset genuinely has no supported futures market | `coin.binanceFuturesSymbol = null` | ⚠️ Not distinguished |
| `DERIVATIVE_SOURCE_UNAVAILABLE` | Futures should exist, but source API could not be reached | `binanceFuturesSymbol ≠ null` BUT API returns null | ❌ Silent → treated as NOT_APPLICABLE |
| `DERIVATIVE_INSUFFICIENT_DATA` | Source works but not enough observations for OI change | `oiCurrent ≠ null` but `oiPrev = null` | ❌ Partial: OI calculated but no change % |
| `DERIVATIVE_INVALID_DATA` | Response exists but fails validation (NaN, negative, etc.) | Response parsing fails | ❌ Caught as error → null |
| `DERIVATIVE_CALCULATION_ERROR` | Inputs exist but feature calculation fails unexpectedly | Exception in calculateDerivativeScore | ❌ Would propagate up |

### Critical Gap

**DERIVATIVE_SOURCE_UNAVAILABLE and DERIVATIVE_NOT_APPLICABLE are currently indistinguishable.**

Both produce:
- `hasFutures = false`
- `score = 50`
- `no_futures = true`
- Same downstream behavior

This means the system cannot tell the difference between:
- "This coin has no futures market" (legitimate, permanent)
- "The API is down right now" (temporary, actionable)

---

## 4. Score Semantics

### Current Behavior

```typescript
if (!hasFutures) {
  return { score: 50, detail: { no_futures: true, ... } };
}
```

Score 50 = "neutral" — the system treats data absence as a neutral market signal.

### Evaluation of Options

#### Option A: score=50 + availability metadata (CURRENT)

```typescript
{ score: 50, detail: { no_futures: true, availability_state: "SOURCE_UNAVAILABLE" } }
```

**Pros:**
- Zero schema change
- Backward compatible
- Health aggregation continues working
- Provenance captured in detail JSON

**Cons:**
- Score 50 is semantically misleading — "data unavailable" ≠ "neutral market"
- Downstream consumers cannot distinguish unavailable from legitimately neutral
- Trend/regime calculations treat 50 as an actual market observation

#### Option B: score=null + explicit availability state

```typescript
{ score: null, detail: { availability_state: "SOURCE_UNAVAILABLE" } }
```

**Pros:**
- Semantically correct: null means "not computed"
- Forces downstream to handle absence explicitly
- Prevents false market signals

**Cons:**
- Schema change: `features.derivative_score` currently NOT NULL
- Health aggregation cannot handle null component
- Breaking change for all consumers
- Requires weight renormalization or null handling in health

#### Option C: score=50 internally but excluded from aggregation

```typescript
// Feature engine produces score=50 but flags it
{ score: 50, detail: { no_futures: true, excluded_from_aggregation: true } }
// Health engine renormalizes: weights = { trend: 0.30/(0.30+0.30+0.25), ... }
```

**Pros:**
- No schema change
- Score 50 exists for audit trail
- Health excludes unavailable features
- More accurate health signal when data is missing

**Cons:**
- Health score changes meaning when derivative is excluded
- Cross-day comparability broken: same coin, different weight denominator
- Regime transitions become unreliable during partial failures
- Adds complexity to health calculation

#### Option D: Provenance-based degradation (RECOMMENDED)

```typescript
// Feature engine:
{ score: 50, detail: { no_futures: true, data_quality: "DEGRADED" } }
// Health engine:
// Uses score 50 (neutral) but records degraded confidence
// Confidence score is reduced when derivative is unavailable
```

**Pros:**
- No schema change
- Backward compatible
- Score 50 is a documented "neutral placeholder" (not market signal)
- Confidence degradation signals data quality
- Health distribution preserved (no renormalization complexity)
- Provenance in detail JSON for audit

**Cons:**
- Score 50 still enters the health calculation (weakly: 15% weight)
- Requires documenting that "score 50 = data unavailable, NOT neutral market"
- Downstream consumers must read detail.no_futures to interpret correctly

### Recommendation

**Option D** is recommended because:
1. Zero schema change
2. Zero breaking change
3. Captures the semantic truth: "we don't know, not 'it's neutral'"
4. Confidence propagation already exists in the system
5. Detail JSON already stores no_futures flag

The key insight is that **confidence score already exists** and is the correct mechanism for signaling data quality, not the feature score itself.

---

## 5. Aggregation Semantics

### Current Behavior

```typescript
healthScore = trend × 0.30 + derivative × 0.15 + volume × 0.30 + momentum × 0.25
```

When derivative = 50 (unavailable): health = trend×0.30 + **7.5** + volume×0.30 + momentum×0.25

### Decision

| Approach | Recommendation | Rationale |
|----------|:--------------:|-----------|
| A. Treat as neutral (score=50) | ✅ **ADOPT** | Simplest; confidence already handles quality signal |
| B. Exclude and renormalize | ❌ Reject | Cross-day comparability breaks; complexity |
| C. Keep nominal + placeholder | Same as A | — |
| D. Mark health as degraded | ✅ **ADOPT** | Via confidence score reduction |

**Contract:** When derivative is unavailable:
- Feature score = 50 (neutral placeholder, documented)
- Health aggregation uses 50 × 0.15 = 7.5 (unchanged)
- Confidence score is reduced (existing mechanism)
- No weight renormalization
- No special health flag

---

## 6. Confidence Semantics

### Current Behavior

From `confidence.ts`:

```typescript
if (!hasFutures) {
  // Redistribute futures weight to other sources
  futW = 0;
  spotW = weights.binance_spot / totalW;
  cgW = weights.coingecko / totalW;
}
```

When `hasFutures = false`:
- Futures weight is zeroed
- Spot and CoinGecko weights are renormalized
- `data_completeness` drops to 66.7% (2/3 sources)
- `confidence_score` reflects only spot + coingecko

### Assessment

The current confidence system already handles the DERIVATIVE_SOURCE_UNAVAILABLE case:

1. When futures API fails → `binanceFuturesOk = false`
2. If `hasFutures = false` (derived from metrics): futures weight redistributed
3. Confidence reflects available sources only
4. `missing_sources` includes `"binance_futures"`

**However:** `hasFutures` is derived from `metrics.openInterest !== null || metrics.fundingRate !== null`. If the API fails, both are null, so `hasFutures = false`. This means the confidence system correctly redistributes weight.

**Gap:** The confidence system treats "futures unavailable" and "coin has no futures" identically. It cannot tell:
- "BTC has no futures data right now" → confidence should be degraded MORE (because we know futures SHOULD exist)
- "RANDOM_TOKEN has no futures market" → confidence redistribution is correct

### Recommended Enhancement

Distinguish in confidence calculation:

```typescript
// Current:
if (!hasFutures) { futW = 0; } // Redistribute

// Proposed:
if (!hasFutures) {
  if (coin.binanceFuturesSymbol) {
    // Futures SHOULD exist but data unavailable → confidence degraded
    futW = weights.binance_futures * 0.5; // Partial penalty, not full redistribution
  } else {
    // Futures genuinely don't exist → redistribute
    futW = 0;
  }
}
```

This requires passing `coinHasFutures` to the confidence calculator. Currently not available.

---

## 7. Observability Contract

### Current Telemetry (INSUFFICIENT)

| Event | Logged? | Structured? | Alertable? |
|-------|:-------:|:-----------:|:----------:|
| Binance Futures API error | ✅ `console.error` | ❌ | ❌ |
| OI null returned | ❌ | ❌ | ❌ |
| Funding null returned | ❌ | ❌ | ❌ |
| OI history empty | ❌ | ❌ | ❌ |
| hasFutures=false | ❌ | ❌ | ❌ |
| derivative_score=50 | ❌ | ❌ | ❌ |
| Source failure → neutral 50 | ❌ | ❌ | ❌ |

### Minimum Required Telemetry

**Per-coin per-refresh:**

```json
{
  "event": "derivative_degradation",
  "coin": "BTC",
  "coin_id": 1,
  "source": "binance_futures",
  "endpoint": "fapi.binance.com/fapi/v1/openInterest",
  "timestamp": "2026-09-03T01:15:00Z",
  "error_class": "AxiosError",
  "http_status": null,
  "degradation_state": "SOURCE_UNAVAILABLE",
  "resulting_score": 50,
  "confidence_impact": -20
}
```

**Per-refresh summary:**

```json
{
  "event": "derivative_degradation_summary",
  "refresh_id": "abc123",
  "coins_affected": 49,
  "total_coins": 49,
  "degradation_rate": "100%",
  "primary_failure": "BINANCE_FUTURES_API_UNREACHABLE",
  "duration_ms": 43000
}
```

### Implementation Recommendation

Add to `processSingleCoin` after the futures metrics section:

```typescript
if (coin.binanceFuturesSymbol && oiCurrent === null && fundingRate === null) {
  console.warn(`[DERIVATIVE-DEGRADED] ${coin.symbol}: ` +
    `Binance Futures API returned null for OI and funding. ` +
    `Source=binance_futures, resulting_score=50, no_futures=true`);
}
```

This is a minimal, zero-risk observability addition.

---

## 8. Binance Failure Investigation

### Evidence

| API Call | Expected | Actual | Error |
|----------|----------|--------|-------|
| `GET /fapi/v1/openInterest?symbol=BTCUSDT` | `{ openInterest: "12345" }` | null | Caught by try/catch |
| `GET /fapi/v1/premiumIndex?symbol=BTCUSDT` | `{ lastFundingRate: "0.0001" }` | null | Caught by try/catch |
| `GET /fapi/futures/data/openInterestHist?symbol=BTCUSDT&period=1d&limit=2` | Array of OI data | `[]` (0 entries) | Caught by try/catch |

### Possible Causes (NOT PROVEN)

1. **Geo/network restriction:** The Vercel/Daytona runtime environment may not have access to `fapi.binance.com`
2. **DNS resolution failure:** `fapi.binance.com` may not resolve in the container
3. **Rate limiting:** Too many concurrent requests (6 × 49 coins = 294 concurrent futures calls)
4. **IP blocking:** Binance may block requests from cloud provider IP ranges
5. **API key requirement:** Some endpoints may require API keys that are not configured
6. **Timeout:** 10s timeout may be insufficient under load

### Root Cause Verdict

```
ROOT_CAUSE_OF_BINANCE_ACCESS_FAILURE_UNRESOLVED
```

The investigation cannot establish the exact reason because:
- axios errors are caught and logged as `console.error` (which may not reach audit logs)
- No HTTP status code is preserved in the return
- No retry mechanism exists
- No diagnostic endpoint to test live API connectivity from the runtime

### Recommended Investigation (for follow-up task)

1. Create a diagnostic endpoint that tests live Binance Futures API connectivity
2. Capture HTTP status, response headers, and error details
3. Test from the same runtime environment as the production refresh
4. If geo-blocked, document network requirements

---

## 9. Source Strategy

### Current: Single Source (Binance Futures)

| Criterion | Assessment |
|-----------|------------|
| Reliability | ❌ Currently failing |
| Coverage | ✅ 49/49 coins have `binanceFuturesSymbol` |
| Semantic equivalence | N/A (no fallback implemented) |
| Rate limits | ⚠️ ~300 requests per refresh |
| Cost | Free |
| Historical compatibility | ✅ All existing data from Binance |

### Fallback Source Evaluation

| Provider | OI Data | Funding Data | Free Tier | Complexity | Recommendation |
|----------|:-------:|:------------:|:---------:|:----------:|:--------------:|
| Binance (primary) | ✅ | ✅ | ✅ | — | Keep |
| Coinglass | ✅ | ✅ | ⚠️ Limited | Medium | Consider |
| CoinGlass Alternative | ⚠️ | ⚠️ | ✅ | High | Defer |
| No fallback | — | — | — | Low | ⚠️ Current state |

**Recommendation:** Do NOT add a fallback source in this task. The primary investigation should determine WHY Binance is failing before adding complexity.

If Binance is confirmed permanently unavailable from the runtime, a fallback may be warranted. But adding fallback without fixing the root cause is premature.

---

## 10. Ownership Boundaries

```
Source Adapter (binance.ts)
    Owns: API calls, HTTP handling, error catching
    Owns: Returning null on failure
    Does NOT own: How null is interpreted

Feature Engine (engine.ts)
    Owns: Determining hasFutures from metrics
    Owns: Calling calculateDerivativeScore with correct parameters
    Does NOT own: API availability

Feature Calculator (derivative.ts)
    Owns: Mathematical calculation
    Owns: Returning score=50 when hasFutures=false
    Does NOT own: Why hasFutures is false

Health Engine (engine.ts → calculateHealthScore)
    Owns: Weighted aggregation
    Does NOT own: Feature availability interpretation

P6 Intelligence (snapshot, regime, recommendation)
    Owns: Interpreting health scores
    Does NOT own: Feature or data quality decisions
```

**Key invariant:** P6 intelligence must NOT reinterpret infrastructure failure as market signal. The system must know that "score 50 because API failed" ≠ "score 50 because market is neutral."

---

## 11. Decision Table

| Condition | Feature State | Score | Health Treatment | Confidence | Observability |
|-----------|:-------------|:-----:|:----------------:|:----------:|:-------------:|
| Futures valid, OI + funding present | DERIVATIVE_AVAILABLE | Calculated (0-100) | Normal weighted | Full weight (40%) | None |
| Coin has no futures symbol | DERIVATIVE_NOT_APPLICABLE | 50 | Neutral placeholder | Weight redistributed | Log once |
| Futures symbol exists but API returns null | DERIVATIVE_SOURCE_UNAVAILABLE | 50 | Neutral placeholder | Weight degraded (50% penalty) | **Log per coin** |
| OI present but no previous OI | DERIVATIVE_INSUFFICIENT_DATA | Partial (OI only) | Normal weighted | Slight degradation | Log warning |
| API returns invalid data | DERIVATIVE_INVALID_DATA | 50 | Neutral placeholder | Weight degraded | **Log per coin** |
| Calculation throws exception | DERIVATIVE_CALCULATION_ERROR | 50 | Neutral placeholder | Weight degraded | **Log error** |

---

## 12. Compatibility Impact

| Area | Impact | Notes |
|------|:------:|-------|
| Feature schema | None | Score stays NOT NULL, detail JSON carries state |
| Historical records | None | No backfill needed |
| Feature versioning | None | p6_version_id unaffected |
| Health aggregation | None | score=50 already used |
| Confidence | Enhancement needed | Distinguish source unavailable vs not applicable |
| Snapshots | None | Health score unchanged |
| Replay | None | Historical scores preserved |
| Alerts | Enhancement needed | Derivative degradation should be alertable |
| UI/API consumers | None | Score=50 displayed; detail shows no_futures |

---

## 13. Recommended Implementation Plan

### Minimum Viable (P6-DATA-04 scope)

1. **Add observability logging** in coin-processor.ts when futures API returns null
2. **Document** the semantic contract (this document)
3. **No schema changes** — zero risk

### Next Priority (separate task)

1. **Fix Binance Futures API access** — determine why calls fail
2. **Distinguish DERIVATIVE_SOURCE_UNAVAILABLE from DERIVATIVE_NOT_APPLICABLE** in detail JSON
3. **Enhance confidence calculation** to penalize source-unavailable differently from not-applicable

### Future Enhancement

1. **Add fallback source** (Coinglass or similar) if Binance is permanently unavailable from runtime
2. **Add retry logic** with exponential backoff for transient failures
3. **Add alerting** for derivative degradation above threshold

---

## 14. Open Questions

1. **Why does the Binance Futures API fail from the runtime?** — ROOT_CAUSE_OF_BINANCE_ACCESS_FAILURE_UNRESOLVED
2. **Is this a temporary network issue or a permanent geo restriction?** — Needs investigation
3. **Should the refresh abort or continue when all futures data is unavailable?** — Current behavior: continue (correct)
4. **Should there be a "minimum data quality" threshold for P6 health to be generated?** — Currently no threshold; health is always generated
5. **Should derivative degradation trigger a user-facing warning?** — Currently no

---

## 15. Follow-up Tasks

| Task | Priority | Description |
|------|:--------:|-------------|
| P6-DATA-05 | High | Investigate and fix Binance Futures API access from runtime |
| P6-OBS-01 | Medium | Add structured observability logging for derivative degradation |
| P6-CONF-01 | Medium | Enhance confidence calculation to distinguish source-unavailable from not-applicable |
| P6-FALLBACK-01 | Low | Evaluate fallback source (Coinglass) if Binance remains unavailable |

---

## 16. Verdict

```
DEGRADATION_CONTRACT_DEFINED
```

The semantic model is sufficiently clear to implement. The minimum viable implementation is observability logging (zero risk). The primary blocker for full derivative functionality is the Binance Futures API access issue, which requires a separate investigation (P6-DATA-05).

### Key Invariants Established

1. **Score 50 = data unavailable, NOT neutral market** — must be documented
2. **Confidence propagation = correct mechanism** for signaling data quality
3. **No weight renormalization** when derivative is unavailable
4. **No schema changes** required for the degradation contract
5. **Observability is the minimum first step** before any architectural changes
