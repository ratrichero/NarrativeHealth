# P6-PROD-09 — Indicator Failure Observability & Root-Cause Capture

## 1. Summary

| Item | Result |
|------|--------|
| Diagnostic logging added | ✅ Refresh route + IndicatorService |
| TypeScript | ✅ PASS (0 errors) |
| Regression | ✅ 1941 PASS / 16 FAIL (baseline) |
| Production error captured | ⏳ Pending — diagnostic code deployed, awaiting next production refresh |
| Root cause determined | ⏳ Partially — see analysis below |

## 2. What Was Done

### 2.1 Diagnostic Logging in Refresh Route

Added structured logging around indicator calculation:

```
[INDICATOR-1D] BTC (id=16): klines=200 → klineData=200, date=2026-08-28, source=binance_spot
[INDICATOR-1D-OK] BTC (id=16): saved for 2026-08-28

OR on failure:

[INDICATOR-1D-FAIL] BTC (id=16, date=2026-08-28, source=binance_spot): <exact error>
[INDICATOR-1D-STACK] BTC: <stack trace>
```

Captures:
- Coin ID, symbol, business date, timeframe, source
- Kline conversion result (input count → output count)
- Success/failure per coin
- Error name, message, and stack trace

### 2.2 Diagnostic Logging in IndicatorService

Enhanced `calculateAndSave()` with step-level logging:

```
[INDICATOR-SVC] coin=16 2026-08-28 1d: calculated=11 indicators
[INDICATOR-SVC] coin=16 2026-08-28 1d: saved=11 failed=0

OR on specific failure:

[INDICATOR-SVC] coin=16: empty data array, skipping
[INDICATOR-SVC] coin=16 2026-08-28 1d: NO indicators calculated (data.length=0)
[INDICATOR-SVC] coin=16: NOT FOUND in coins table, skipping
[INDICATOR-SVC] coin=16 2026-08-28 1d EMA_9: DB INSERT FAILED: <error>
```

Captures:
- Data input validation
- Indicator calculation count
- Coin existence check
- Per-indicator DB insert success/failure
- Aggregate saved/failed counts

## 3. Code Path Analysis

The indicator calculation flows through 5 potential failure points:

```
1. klines.length > 0 check           → If 0, indicators skipped silently
2. convertBinanceKlines(klines)      → Pure conversion, unlikely to throw
3. calculateIndicators(data, tf)     → Pure math, returns [] if data.length=0
4. coin DB lookup                    → Returns empty if coin not found
5. DB insert/upsert per indicator    → Can fail on schema/type mismatch
```

### 3.1 Evidence That Rules Out Some Hypotheses

| Hypothesis | Evidence | Status |
|-----------|----------|--------|
| klines empty (Binance API fails) | Features ARE created for Aug 28 → klines exist | RULED OUT |
| coin not found | Coin 16 has indicators from Aug 25 | RULED OUT |
| calculateIndicators returns [] | Unlikely — pure math on valid KlineData[] | LOW PROBABILITY |
| DB insert fails | Possible — schema mismatch or type error | HIGH PROBABILITY |
| convertBinanceKlines throws | Possible if kline format changed | MEDIUM PROBABILITY |

### 3.2 Key Observation

Features ARE being created for Aug 28 (verified in DB). This means:
- Binance API calls succeed on production
- klines are fetched
- marketPriceDaily rows are created
- Feature calculation works

But indicators are NOT created. The difference:
- Feature code runs AFTER indicator code in the same per-coin try block
- Indicator code has its own inner try/catch
- If indicator throws, the error is caught and logged (now captured)
- Feature code continues after the indicator catch block

## 4. Production State

### 4.1 Scheduler Logs (Latest)

| # | Job | Status | Coins | Duration |
|---|-----|--------|-------|----------|
| 353 | P6-PROD-09-diag-test | COMPLETED | 49 | 144s |
| 352 | P6-PROD-08-test | COMPLETED | 49 | 143s |
| 351 | p6-prod-07-test | COMPLETED | 49 | 145s |
| 349 | manual_refresh | COMPLETED | 49 | 29s |

Production refreshes complete successfully with 0 scheduler-level errors.

### 4.2 Indicator State

```
Latest indicator date: 2026-08-25
Total indicators: 10,752
Indicators after Aug 25: 0
```

## 5. Deployment

```
Diagnostic commit: 98e1ac7
Pushed: origin/main (348a869..98e1ac7)
Status: Deployed (Vercel auto-deploy)
```

## 6. Why PD-E2 Did Not Resolve It

PD-E2 fixed: `evaluateKlineObservationQuality` no longer throws and skips coin processing.

But indicators have a SEPARATE failure path inside their own try/catch. The indicator calculation at lines 522-538 has its own error handler that catches all errors and only does `console.error()`. This error was NOT visible in scheduler logs.

The PD-E2 fix was necessary but NOT sufficient. The indicator failure is a distinct issue that was masked by the quality evaluation blocking coin processing entirely.

## 7. What the Diagnostic Logging Will Show

On the next production refresh (scheduled ~every 4 hours), the diagnostic logs will reveal:

1. Whether `klines.length > 0` → confirms klines are fetched
2. Whether `convertBinanceKlines` succeeds → confirms conversion
3. Whether `calculateIndicators` returns results → confirms math works
4. Whether coin lookup succeeds → confirms coin exists
5. Whether DB insert succeeds → confirms schema compatibility
6. The exact error message and stack trace

## 8. Remaining Action

After the next production refresh runs with diagnostic logging:

1. Check production logs for `[INDICATOR-*]` entries
2. The exact error will be captured in the structured log output
3. If the error is deterministic (code/config/data defect), implement the minimal fix in P6-PROD-10
4. If the error requires schema changes, stop and report

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
P6-01…P6-09:    untouched (only diagnostic logging added)
Schema:         untouched
API:            untouched
UI:             untouched
```

## 11. Files Changed

| File | Change |
|------|--------|
| src/app/api/refresh/route.ts | Add diagnostic logging around indicator calculation |
| src/lib/services/indicator.service.ts | Add diagnostic logging inside calculateAndSave |
| docs/P6_Upgrade/P6-PROD-09_*.md | This report |

## 12. Findings

```
Class A: 0 (no blocking findings)
Class B: 0 (diagnostic logging deployed, awaiting production data)
Class C: 0
Class D: 0
```

## 13. Final Verdict

```
DIAGNOSTIC LOGGING DEPLOYED — AWAITING PRODUCTION CAPTURE

Root cause:    NOT YET CAPTURED (sandbox cannot reach Binance API)
Diagnostic:    Deployed at 98e1ac7, active on production
Next step:     Wait for next production refresh, capture [INDICATOR-*] logs
Data gap:      Aug 26-28 (3 days, requires backfill after root cause fixed)

VERDICT: PRODUCTION ERROR NOT CAPTURED — INCIDENT OPEN

The diagnostic code is deployed and will capture the exact error
on the next production refresh. The error cannot be captured from
the sandbox due to Binance API geo-restriction.
```

---

## 14. Git Boundary

```
Working tree: clean
New commit: 98e1ac7 (diagnostic logging only)
No frozen contract changes
No schema changes
No API changes
No UI changes
```
