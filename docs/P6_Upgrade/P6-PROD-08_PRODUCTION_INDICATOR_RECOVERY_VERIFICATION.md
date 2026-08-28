# P6-PROD-08 — Production Indicator Recovery & Smoke Verification

## 1. Summary

| Item | Result |
|------|--------|
| Code fix deployed | ✅ Confirmed (scheduler logs prove quality eval errors are now caught) |
| Refresh executed | ✅ 2 refreshes completed Aug 28 (49 coins each, 0 errors) |
| Indicators new rows | ❌ **0 new indicators since Aug 25** |
| ≥3 coins verified | ❌ NO — no coins have new indicators |
| Coin 16 verified | ❌ NO — coin 16 last indicator: Aug 25 |
| 1D API data | ❌ NO — `/api/indicators/16?date=2026-08-28&timeframe=1d` returns empty |
| Coin UI data | ❌ UI_RUNTIME_NOT_VERIFIABLE |
| P6 intelligence | P6-PROD-04 tables exist but no pipeline data |
| No regression | ✅ TypeScript PASS, 1941 PASS / 16 FAIL (pre-existing) |

## 2. Deployment Status

```
HEAD:           79a169f  fix(P6-PROD-07): wrap evaluateKlineObservationQuality in try/catch per PD-E2
Deployed:       15ed5f6  docs(P6-PROD-06): identify indicator regression root cause

NOTE: The user stated deployment 15ed5f6 is on production.
However, scheduler logs show that refreshes completed with 0 errors
while p6_observations is MISSING, proving the fix (79a169f) IS deployed.
```

## 3. PD-E2 Fix Verification

### 3.1 Contract

```
PD-E2: Classification never blocks ingestion — infrastructure errors
       from quality persistence (e.g. missing table) are caught here so
       they cannot skip downstream indicator calculation or feature creation.
```

### 3.2 Fix applied (79a169f)

```typescript
// BEFORE (violated PD-E2):
await evaluateKlineObservationQuality(kline, {...});

// AFTER (PD-E2 compliant):
try {
  await evaluateKlineObservationQuality(kline, {...});
} catch (qualityError) {
  console.warn(`[P6-01E-C] Quality evaluation failed...`);
}
```

### 3.3 Evidence fix is deployed

| Evidence | Value |
|----------|-------|
| Scheduler #351 (p6-prod-07-test) | COMPLETED, 49 coins, 0 errors |
| Scheduler #352 (P6-PROD-08-test) | COMPLETED, 49 coins, 0 errors |
| p6_observations table | MISSING |
| Features created (Aug 28) | YES |
| Quality eval error visible | Caught (not propagating to per-coin catch) |

The fix IS deployed and IS working correctly for PD-E2.

## 4. Production Database State

### 4.1 Indicators by Date

| Date | Rows | Coins |
|------|------|-------|
| 2026-08-25 | 1,029 | 49 |
| 2026-08-24 | 1,029 | 49 |
| 2026-08-22 | 1,029 | 49 |
| 2026-08-21 | 1,029 | 49 |
| 2026-08-20 | 987 | 47 |

### 4.2 Total Stats

```
Total rows:     10,752
Distinct coins: 49
Latest date:    2026-08-25
Latest calc_at: 2026-08-25T05:05:22.667Z
1D indicators:  5,632 rows across 49 coins
4H indicators:  5,120 rows
```

### 4.3 Coin 16

```
Latest 1D: Aug 25, 11 indicator types
Latest 4H: Aug 25, 10 indicator types
Total:     154 rows (1D)
```

### 4.4 Post-Fix Indicators

```
Indicators after Aug 25: 0
```

## 5. Production Scheduler Logs

| ID | Job | Status | Coins | Duration | Error |
|----|-----|--------|-------|----------|-------|
| 352 | P6-PROD-08-test | COMPLETED | 49 | 143s | null |
| 351 | p6-prod-07-test | COMPLETED | 49 | 145s | null |
| 350 | prod06_indicator_test | STARTED | 0 | — | null |
| 349 | manual_refresh | COMPLETED | 49 | 29s | null |

## 6. Root Cause Analysis

### 6.1 What is fixed

- ✅ PD-E2: `evaluateKlineObservationQuality` now caught in try/catch
- ✅ Refresh completes without crashing when `p6_observations` is missing
- ✅ Feature creation continues (not blocked by quality eval)
- ✅ Indicator calculation code is reached (not skipped by quality eval failure)

### 6.2 What is NOT fixed

- ❌ Indicator calculation produces 0 rows for Aug 26-28
- ❌ The indicator catch block silently swallows errors: `console.error()` only
- ❌ Cannot determine WHY indicator calculation fails from production logs

### 6.3 Hypothesis for remaining indicator failure

The indicator calculation at lines 522-538 has its own try/catch:
```typescript
try {
  const { convertBinanceKlines } = await import("@/lib/technical-analysis/indicators");
  await indicatorService.calculateAndSave(convertBinanceKlines(klines), coin.id, today, '1d', priceSource);
} catch (e) {
  console.error(`Failed to calculate 1d indicators for ${coin.symbol}:`, e);
}
```

The error is logged to `console.error` but NOT propagated to the scheduler log.
Possible causes:
1. `convertBinanceKlines()` fails or returns empty data
2. `indicatorService.calculateAndSave()` throws (e.g. missing columns, DB error)
3. `priceSource` is undefined for some coins
4. `today` variable is undefined or wrong format

**Cannot diagnose without production console access or enhanced logging.**

## 7. Timezone Analysis

```
UTC date:       2026-08-28
VN date:        2026-08-28
UI requests:    2026-08-28 (UTC via new Date().toISOString())
Indicators use: 2026-08-28 (via getBusinessDate = VN date)
Mismatch:       NO — both are Aug 28 at current time
```

The UI timezone mismatch does NOT explain the indicator gap. The real issue is that indicators simply aren't being created at all.

## 8. Production API Smoke

| Endpoint | HTTP | Result |
|----------|------|--------|
| GET /api/narratives/1 | 200 | ✅ success: true, data present |
| GET /api/coins/16 | 200 | ✅ success: true, data present |
| GET /api/indicators/16?date=2026-08-28&timeframe=1d | 200 | ⚠️ success: true, data: [] (empty) |
| GET /api/indicators/16?date=2026-08-25&timeframe=1d | 200 | ✅ success: true, data present |

## 9. Regression

```
TypeScript:   PASS (0 source errors)
Tests:        1941 PASS / 16 FAIL (pre-existing P3 issues, matches baseline)
```

## 10. Boundary

```
P3:             untouched
P4:             untouched
P5:             untouched
P5 replay:      untouched
P6-01…P6-09:    untouched (only src/app/api/refresh/route.ts modified in P6-PROD-07)
P6-FINAL:       untouched
Schema:         untouched
API:            untouched
UI:             untouched
```

## 11. Files Changed

| File | Change | Task |
|------|--------|------|
| src/app/api/refresh/route.ts | Wrap evaluateKlineObservationQuality in try/catch | P6-PROD-07 |
| docs/P6_Upgrade/P6-PROD-06_*.md | Investigation report | P6-PROD-06 |
| docs/P6_Upgrade/P6-PROD-07_*.md | Fix report | P6-PROD-07 |
| drizzle/migrations/0029_*.sql | P6-02E migration | P6-PROD-03 |
| drizzle/migrations/0030_*.sql | P6 core tables migration | P6-PROD-04 |
| scripts/apply-p6-*.js | Migration scripts | P6-PROD-03/04 |

## 12. Findings

```
Class A: 0 (no new blocking findings)
Class B: 1 — Indicator calculation silently fails without diagnostic data
         Root cause UNKNOWN — requires enhanced logging or production console
Class C: 1 — Indicator data gap Aug 26-28 (operational, not code defect)
Class D: 0
```

## 13. What is needed for full resolution

To complete the indicator recovery, one of:

1. **Enhanced logging** — Add detailed logging to the indicator calculation catch block so production logs show the actual error
2. **Production console access** — Read `console.error` output from production to identify the exact failure
3. **Manual indicator trigger** — Run indicator calculation for a single coin in isolation to capture the error

## 14. Final Verdict

```
INDICATOR PRODUCER FIX DEPLOYED — INDICATOR DATA NOT YET RECOVERED

PD-E2 fix:           ✅ VERIFIED DEPLOYED
Quality eval:        ✅ NO LONGER BLOCKS INGESTION
Indicator creation:  ❌ SILENTLY FAILING (root cause unknown)
Production data:     ❌ NO NEW INDICATORS SINCE AUG 25
Backfill gap:        Aug 26-28 (3 days, not recoverable without backfill)

REMAINING BLOCKER: Indicator calculation has a silent failure that
cannot be diagnosed without production console logs or enhanced logging.

NEXT ACTION: Add detailed error logging to indicator calculation catch
block, redeploy, trigger refresh, verify indicator creation.
```

---

## 15. Git Boundary

```
Working tree: clean
HEAD:         79a169f
No new changes in this task (documentation only)
```
