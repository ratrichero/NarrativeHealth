# P6-PROD-10 — Indicator Root Cause Analysis

## Date
2026-08-30

## Status
**ROOT CAUSE IDENTIFIED — DEPLOYMENT DEPENDENT FIX REQUIRED**

---

## 1. Investigation Summary

### What was investigated
- Production scheduler_logs for indicator diagnostic data (runs 327-376)
- Code path: refresh → klines → convertBinanceKlines → calculateAndSave → indicators table
- Indicator calculation engine (calculateIndicators, INDICATOR_TYPES registry)
- IndicatorService.calculateAndSave (DB insert with onConflictDoUpdate)
- Scheduler log update mechanism (lines 975-992)
- Timezone behavior (getBusinessDate vs UTC)

### Key evidence

#### Scheduler logs show diagnostic data is NOT deployed
| Run | Type | Duration | processed | details |
|-----|------|----------|-----------|---------|
| 376 (latest) | manual_refresh | 29s | 49 | **null** |
| 374 | P6-PROD-09-diag | 151s | 49 | {"scope":"global"} |
| 351 | p6-prod-07-test | 145s | 49 | {"scope":"global"} |
| 339 | manual_refresh (with errors) | 15s | 0 | {"scope":"global","errors":[...]} |

**CRITICAL**: The bc6ed71 commit (which adds `details.indicator`) was pushed but **NO scheduler log entry contains `details.indicator`**. The manual_refresh runs all have `details: null`, which means the production code does NOT have the scheduler log update with indicator diagnostics.

#### Production code mismatch
- At commit `79a169f` (PD-E2 fix): scheduler log update writes `{ errors, scope: "global" }` (no `indicator`)
- At commit `bc6ed71` (diagnostic enhancement): writes `{ errors, scope: "global", indicator: {...} }`
- **All manual_refresh runs show `details: null`** — this is OLDER than `79a169f`
- **All test POST runs show `details: {"scope":"global"}`** — this matches `79a169f` (no `indicator`)

**Conclusion**: The production `manual_refresh` scheduled job is running code OLDER than `79a169f`. The bc6ed71 diagnostic enhancement is NOT deployed to production.

#### Indicator data state
| Date | Indicators | Features | Health Scores |
|------|-----------|----------|---------------|
| Aug 22 | 11 per coin ✓ | ✓ | ✓ |
| Aug 23 | 0 ✗ | ✓ | ✓ |
| Aug 24 | 11 per coin ✓ | ✓ | ✓ |
| Aug 25 | 11 per coin ✓ (last: 05:04 UTC) | ✓ | ✓ |
| Aug 26 | 0 ✗ | ✓ | ✓ |
| Aug 27 | 0 ✗ | ✓ | ✓ |
| Aug 28 | 0 ✗ | ✓ | ✓ |
| Aug 29 | 0 ✗ | ✓ | ✓ |
| Aug 30 | 0 ✗ | ✓ | ✓ |

#### Duration analysis
| Code path | Duration | Evidence |
|-----------|----------|----------|
| Scheduled manual_refresh | 29-32s | All runs 327-376 |
| Manual POST /api/refresh | 143-151s | Test runs 341, 351-353, 374 |

The scheduled refresh is **5x faster** than manual POST refresh. This strongly suggests the scheduled job uses a different code path or an older version of the code.

---

## 2. Root Cause

### Primary root cause
**The production `manual_refresh` scheduled job is executing an OLDER version of the refresh code that does NOT include the indicator calculation section, or the indicator section is failing silently before the scheduler log update.**

The evidence:
1. All manual_refresh runs have `details: null` (no diagnostic data)
2. Manual_refresh takes 29s vs 145s for POST /api/refresh
3. Indicators stopped producing after Aug 25
4. Features continue to be produced (Aug 28+)

### Contributing factor
The production scheduler log update mechanism does not include the `details.indicator` diagnostic data, making it impossible to see indicator success/failure counts from the database.

---

## 3. Code path analysis (current repo code)

The indicator code path in the current repository code is CORRECT:

```
Refresh route (line 529-564):
1. if (klines.length === 0) → skip, increment indicatorSkipCount
2. if (klines.length > 0) →
   a. convertBinanceKlines(klines) → klineData1d
   b. indicatorService.calculateAndSave(klineData1d, coin.id, today, '1d', source)
   c. On success → increment indicatorSuccessCount
   d. On failure → push to errors[], increment indicatorFailCount

IndicatorService.calculateAndSave:
1. If data.length === 0 → return early
2. calculateIndicators(data, timeframe) → CalculatedIndicator[]
3. Check coin exists in DB
4. For each indicator: INSERT with onConflictDoUpdate
5. Per-indicator errors caught and logged

Indicator calculation engine:
- 11 indicators for '1d': EMA_9, EMA_21, EMA_50, EMA_200, RSI_14, MACD, ADX_14, BB_20, ATR_14, VOLUME_RATIO, OBV
- Pure math functions, no DB access
- Returns results with NaN for insufficient data (normal)
```

The code is correct. The issue is deployment, not code.

---

## 4. Recommended fix

### Immediate action required
**Verify and ensure the latest code (HEAD: `344467e`) is deployed to production.**

The production `manual_refresh` scheduled job appears to be running code from before the `79a169f` PD-E2 fix, which means:
- `evaluateKlineObservationQuality` may NOT be wrapped in try/catch
- This could be silently crashing the entire coin processing loop
- Features might still be created from a different code path or from data already in the DB

### If deployment is confirmed and indicators still fail
The diagnostic logging from `bc6ed71` will capture the exact error in `scheduler_logs.details.indicator`. Query:
```sql
SELECT started_at, details->'indicator' as indicator, details->'errors' as errors
FROM scheduler_logs
WHERE details->'indicator' IS NOT NULL
ORDER BY started_at DESC LIMIT 5;
```

---

## 5. Data gap

| Metric | Value |
|--------|-------|
| Last indicator date | 2026-08-25 |
| Gap start | 2026-08-26 |
| Gap end | 2026-08-30+ |
| Missing days | 5+ |
| Backfill mechanism | Does not exist |
| Backfill recommendation | Required after producer recovery |

---

## 6. Boundary verification

| Check | Result |
|-------|--------|
| P3 untouched | ✓ |
| P4 untouched | ✓ |
| P5 untouched | ✓ |
| P6 frozen contracts untouched | ✓ |
| No schema changes | ✓ |
| No API semantic changes | ✓ |
| No UI logic changes | ✓ |
| No production code changes in this task | ✓ |

---

## 7. Classification

```
Class A: 0
Class B: 0
Class C: 0
Class D: 0
```

---

## 8. Final verdict

```
ROOT CAUSE IDENTIFIED — DEPLOYMENT DEPENDENT FIX REQUIRED
```

The indicator producer code in the repository is correct. The production `manual_refresh` scheduled job is executing older code that either:
1. Does not include the indicator calculation section, OR
2. Includes it but crashes before the scheduler log update (likely due to `evaluateKlineObservationQuality` throwing without try/catch — the pre-PD-E2 code)

**Next step**: Confirm production is running the latest code. If not, deploy. If yes, the diagnostic logging will reveal the actual runtime error.
