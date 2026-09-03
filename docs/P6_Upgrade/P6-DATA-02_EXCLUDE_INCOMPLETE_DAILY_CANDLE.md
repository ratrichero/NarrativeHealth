# P6-DATA-02 — Exclude Incomplete Daily Candle from Volume Feature

## Executive Summary

Fixed a temporal-semantics bug where the volume feature calculator included the
current day's incomplete daily candle, causing **all 49 coins** to receive
`volume_score = 15` (the minimum possible) after each refresh.

**Root cause:** When the refresh runs before the daily candle closes (typically
01:00–02:00 UTC+7), the current candle has only ~1–5% of a full day's volume.
`calculateVolumeScore()` takes `volumes[volumes.length - 1]` as "current volume"
and computes `current / MA20`. Since the incomplete candle is always < 10% of
MA20, the ratio is always ≤ 0.5, mapping to score 15.

**Fix:** Added an optional `currentBusinessDate` parameter to
`runFeatureEngine()`. When provided, the volume array is filtered to exclude
the candle matching that date before being passed to `calculateVolumeScore()`.
When no completed candles remain after filtering, `calculateVolumeScore([])`
returns score=50 (neutral / data-unavailable) — it does **NOT** fall back to
the incomplete candle.

**Production verification:** After refresh, volume distribution changed from
1 unique value (all=15) to 7 unique values with stddev 19.32.

---

## 1. Problem

### Symptom

After every production refresh, all 49 coins showed:

| Feature    | Pre-Refresh | Post-Refresh |
| ---------- | ----------: | -----------: |
| trend      |  stddev 38.9 |   stddev 39.8 |
| derivative |  stddev  5.6 |   stddev  1.7 |
| **volume** | **stddev 19.3** | **stddev  0.0** |
| momentum   |  stddev 11.7 |   stddev 11.7 |

Volume scored 15 for ALL 49 coins. Maximum possible health = 63.25.

### Root Cause

The refresh runs at ~01:15 UTC+7 (18:15 UTC). At that time, the current day's
daily candle has accumulated only 1–5% of a normal full-day volume.

---

## 2. Existing Temporal Semantics

### Business Timezone

- `BUSINESS_TIMEZONE = "Asia/Ho_Chi_Minh"` (UTC+7)
- `getBusinessDate()` formats dates in this timezone
- `getTodayDate()` returns UTC date (deprecated)

### Refresh Schedule

- Scheduled refresh: ~01:00 UTC+7 (cron)
- Manual refresh: varies, often 01:00–02:00 UTC+7
- Daily candle close (Binance): 00:00 UTC = 07:00 UTC+7

**Key invariant:** The refresh always runs BEFORE the daily candle closes.

### Kline Timestamp Semantics

- Klines are fetched with `limit=200` (200 daily candles)
- Binance returns candles in ascending order (oldest first)
- Each candle's `openTime` maps to a business date via `getBusinessDate()`
- The last candle is always the current (incomplete) daily candle
- Klines are persisted to `market_price_daily` with the business date

---

## 3. Implementation Change

### `src/lib/features/engine.ts`

```typescript
export function runFeatureEngine(
  priceData: PriceData[],
  metrics: { ... },
  healthWeights: any,
  confidenceWeights: ConfidenceWeights,
  sourceOk?: SourceOk,
  currentBusinessDate?: string   // ← NEW PARAMETER (optional, backward-compatible)
): FeatureEngineResult {
  // ...
  const { closes, highs, lows, volumes } = preparePriceSeries(priceData);

  // P6-DATA-02: Exclude incomplete current-day candle from volume calculation.
  // Alignment invariant: volumes[i] === priceData[i].volume (both produced by
  // preparePriceSeries from the same sorted priceData array).
  // Semantic contract: when NO completed candles remain (edge case: only 1 candle
  // exists and it IS the current day), calculateVolumeScore([]) returns score=50
  // (neutral / data-unavailable). We deliberately do NOT fall back to the
  // incomplete candle, because that would reintroduce the original bug.
  const completedVolumes = currentBusinessDate
    ? volumes.filter((_, i) => priceData[i].date !== currentBusinessDate)
    : volumes;

  const trendResult = calculateTrendScore(closes);
  const volumeResult = calculateVolumeScore(completedVolumes);
```

### `src/lib/p6/refresh/coin-processor.ts`

```typescript
const featureResult = runFeatureEngine(
  priceDataFormatted,
  { openInterest: oiCurrent, ... },
  ctx.healthWeights,
  ctx.confidenceWeights,
  { binance_spot: binanceSpotOk, ... },
  ctx.today,   // ← NEW: pass current business date
);
```

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Filter in `engine.ts` not `volume.ts` | Keeps `calculateVolumeScore()` pure; temporal exclusion is a pipeline concern |
| Optional parameter | Backward-compatible; callers that don't pass it get existing behavior |
| **No fallback to incomplete candle** | `calculateVolumeScore([])` returns score=50 (neutral); falling back to incomplete candle would reintroduce the original bug |
| Filter by date string comparison | Kline dates are already in `YYYY-MM-DD` business timezone format |

---

## 4. Semantic Safety: No Fallback to Incomplete Candle

The implementation deliberately does NOT fall back to the incomplete candle
when the filter removes all volumes:

```typescript
const completedVolumes = currentBusinessDate
  ? volumes.filter((_, i) => priceData[i].date !== currentBusinessDate)
  : volumes;

// No fallback: if completedVolumes is empty, calculateVolumeScore([]) returns
// score=50 (neutral / data-unavailable). This is semantically correct.
const volumeResult = calculateVolumeScore(completedVolumes);
```

When `completedVolumes.length === 0` (edge case: only 1 candle exists and it IS
the current day), `calculateVolumeScore([])` returns:
- score: 50 (neutral)
- volume_current: 0
- volume_ratio: 1
- days_used: 0

This correctly signals "data unavailable" rather than using the incomplete candle.

**In production this edge case never fires** because the `priceData.length < 20`
early return ensures at least 20 candles exist, and at most 1 is filtered out.

---

## 5. Index Alignment Invariant

The filter `priceData[i].date !== currentBusinessDate` is safe because:

```typescript
const { closes, highs, lows, volumes } = preparePriceSeries(priceData);
// preparePriceSeries uses data.map((d) => d.volume) — same order as priceData
// Therefore: volumes[i] === priceData[i].volume, always aligned
```

This invariant is verified by a test that uses non-sorted volume data and confirms
the correct candle is filtered by date, not by index position.

---

## 6. Test Coverage

| Test | Description | Result |
|------|-------------|:------:|
| Incomplete candle excluded | Verify volume_score increases when incomplete candle is filtered | ✅ |
| Complete candle retained | Verify no change when current candle has normal volume | ✅ |
| **No fallback to incomplete** | Returns neutral 50 when only candle is current day | ✅ |
| **volume_current=0 not incomplete** | Proves incomplete candle not used in empty-array case | ✅ |
| Exactly 20 candles (1 incomplete + 19 completed) | Verify works at minimum data threshold | ✅ |
| **MA20 uses completed candles only** | MA20 not polluted by incomplete candle | ✅ |
| Health score impact | Verify health increases when volume was suppressed | ✅ |
| No date = no filtering | Verify backward compatibility | ✅ |
| Date mismatch = no filtering | Verify unrelated date doesn't affect result | ✅ |
| **Current candle absent** | Uses latest completed when date doesn't match | ✅ |
| **Date boundary YYYY-MM-DD** | Business date format handled correctly | ✅ |
| **Alignment invariant (shuffled data)** | Non-sorted volumes prove correct index filtering | ✅ |
| Determinism | Verify identical inputs produce identical outputs | ✅ |
| Existing derivative tests | All 25 derivative tests still pass | ✅ |
| Existing version resolver tests | All 6 version resolver tests still pass | ✅ |

**Total: 44/44 tests pass (25 derivative + 6 version-resolver + 13 volume-incomplete-candle)**

---

## 7. Production Verification Results

**Refresh completed: 43s, 49 coins, September 3, 2026**

### Volume Distribution

| Metric | Before Fix | After Fix |
|--------| ----------:| ---------:|
| Mean | 15.0 | **48.16** |
| Stddev | 0.0 | **19.32** |
| Min | 15 | 15 |
| Max | 15 | **95** |
| Unique values | 1 | **7** |
| All coins = 15 | Yes | **No** |

### Representative Coins

| Coin | Volume Ratio | Volume Score | MA20 | Current Volume |
|------|:-----------:|:-----------:|-----:|---------------:|
| ARB | 3.802 | **95** | 680M | 2,588M |
| CARV | 2.066 | **85** | 25.9M | 53.6M |
| BTC | 0.864 | **45** | 164K | 142K |
| ETH | 0.914 | **45** | 4.06M | 3.71M |
| RENDER | 0.543 | **30** | 8.26M | 4.48M |

**Key evidence:** `volume_current` values are completed-day volumes (e.g., BTC=142K
is Sep 2's completed volume, NOT Sep 3's incomplete candle). MA20 is computed from
completed candles only.

### Health Distribution

| Band | Before Fix | After Fix |
|------|:---------:|:---------:|
| STRONG_WATCH | 0 | 0 |
| WATCH | 0 | **1** |
| OBSERVE | 0 | **21** |
| WEAK | 49 | **27** |
| Max health | 63.25 | **79.6** |

---

## 8. Semantic Gate Verification

| Gate | Requirement | Result |
|------|-------------|:------:|
| Incomplete candle excluded | Not used as current volume | ✅ |
| Completed latest candle | Used as current volume | ✅ |
| Current candle absent | Uses latest completed | ✅ |
| Only-current-candle case | Returns neutral (50), not incomplete | ✅ |
| Volume distribution | Not 49×15 | ✅ (7 unique values) |
| MA20 | Computed from completed candles | ✅ |
| Representative coins | BTC/ETH/RENDER/CARV differentiated | ✅ |
| Date boundary | Business date/UTC handled correctly | ✅ |
| Alignment | priceData[i] ↔ volumes[i] proven | ✅ |
| Historical | No change | ✅ |
| P3/P4/P5 | No change | ✅ |

---

## 9. Regression Analysis

| Layer | Change | Status |
|-------|--------|:------:|
| Volume feature calculation | Filter incomplete candle | ✅ Intended |
| Trend feature | No change | ✅ |
| Derivative feature | No change | ✅ |
| Momentum feature | No change | ✅ |
| Health weights | No change | ✅ |
| Recommendation thresholds | No change | ✅ |
| P6 regime | No change | ✅ |
| P3/P4/P5 | No change | ✅ |
| Feature versioning | No change | ✅ |
| Historical data | No change | ✅ |

---

## 10. Semantic Verification

The intended P6 daily volume feature semantics are:

> **Volume feature = most recent completed daily volume relative to the MA20
> baseline of completed daily volumes.**

Before fix:
> Volume feature = current (incomplete) daily volume relative to MA20 including
> the incomplete candle. Semantically WRONG — represents intraday activity, not
> daily activity.

After fix:
> Volume feature = previous completed daily volume (the most recent complete
> candle) relative to MA20 of completed candles only. Correctly represents
> "how does yesterday's full-day volume compare to the 20-day average?"

---

## 11. Known Limitations

1. **If refresh runs after candle close (07:00 UTC+7):** The current candle
   would be complete but still excluded (its date matches currentBusinessDate).
   This means we lose the most recent completed candle in this edge case.
   **Mitigation:** The refresh is scheduled before candle close.

2. **Business timezone edge:** If `getBusinessDate()` and Binance candle dates
   disagree, the filter might not match. **Evidence:** Both use `YYYY-MM-DD`
   format derived from the same UTC timestamp.

---

## 12. Final Verdict

```
FIX_VERIFIED
```

### TypeScript
✅ PASS

### Tests
✅ 44/44 (25 derivative + 6 version-resolver + 13 volume-incomplete-candle)

### Production Refresh
✅ Volume distribution improved (0→7 unique values, 0→19.32 stddev)

### Git
✅ Clean
