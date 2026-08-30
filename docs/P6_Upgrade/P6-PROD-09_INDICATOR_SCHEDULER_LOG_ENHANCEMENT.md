# P6-PROD-09 — Indicator Failure Observability & Root-Cause Capture

## Status: DIAGNOSTIC DEPLOYED — AWAITING PRODUCTION CAPTURE

## Commit

```
bc6ed71  diag(P6-PROD-09): route indicator errors into scheduler log
```

## What Was Done

### Problem Identified

P6-PROD-08 found that the diagnostic logging (console.log/console.error) from P6-PROD-09 was **invisible in production** because:

1. Console output goes to stdout/stderr — NOT to the scheduler_logs table
2. The `errors[]` array only captured outer per-coin catch errors
3. Inner indicator try/catch errors were silently swallowed

### Fix Applied

Three changes to `src/app/api/refresh/route.ts`:

#### 1. Added indicator counters
```typescript
let indicatorSuccessCount = 0;
let indicatorFailCount = 0;
let indicatorSkipCount = 0; // klines.length === 0
```

#### 2. Capture klines.length === 0 (previously silent)
```typescript
if (klines.length === 0) {
  indicatorSkipCount++;
  console.warn(`[INDICATOR-SKIP] ${coin.symbol} ...`);
}
```

#### 3. Route errors into scheduler log
```typescript
// In indicator catch blocks:
errors.push(`[INDICATOR-1D] ${coin.symbol}: ${errMsg}`);
indicatorFailCount++;

// In scheduler log update:
details: {
  errors,
  scope: "global",
  indicator: {
    success: indicatorSuccessCount,
    failed: indicatorFailCount,
    skipped_empty_klines: indicatorSkipCount,
    businessDate: today,
  },
}
```

### What This Enables

After the next production refresh, query `scheduler_logs`:
```sql
SELECT started_at, details
FROM scheduler_logs
WHERE details->>'indicator' IS NOT NULL
ORDER BY started_at DESC LIMIT 5;
```

This will reveal:
- **success**: How many coins had indicators calculated
- **failed**: How many coins had indicator errors (with exact error in `errors[]`)
- **skipped_empty_klines**: How many coins had no klines (silent skip root cause)
- **businessDate**: What date the indicators were calculated for

### Possible Root Causes (will be confirmed by production data)

| Scenario | Diagnostic Evidence |
|---|---|
| **A: klines empty** | `skipped_empty_klines > 0` |
| **B: convertBinanceKlines fails** | `[INDICATOR-1D] coin: error` in errors[] |
| **C: calculateIndicators fails** | Same as B |
| **D: DB insert fails** | `[INDICATOR-SVC] ... DB INSERT FAILED` in errors[] |
| **E: calculateAndSave returns empty** | `success > 0` but no DB rows |

### Regression

```
TypeScript:   PASS (0 errors)
Tests:        1941 PASS / 16 FAIL (pre-existing P3)
```

### Boundary

```
P6 frozen contracts: UNTOUCHED
P4: UNTOUCHED
P5: UNTOUCHED
Schema: UNTOUCHED
API: UNTOUCHED
UI: UNTOUCHED
```

## Files Changed

| File | Change |
|---|---|
| `src/app/api/refresh/route.ts` | +23/-2 — diagnostic counters, error routing, scheduler log enhancement |

## Data Gap

```
Aug 25 → Aug 30: 5 days of missing indicator data
Recovery:         Requires backfill after root cause is identified and fixed
```

## Final Verdict

```
DIAGNOSTIC LOGGING ENHANCED — SCHEDULER LOG CAPTURE READY
```

**Next step:** After the next production refresh runs, query `scheduler_logs` to see the indicator diagnostic data. This will reveal the exact root cause:
- If `skipped_empty_klines = 49`: klines are empty on production (API issue or geo-restriction)
- If `failed = 49`: indicator calculation throws (need error message from errors[])
- If `success = 49` but indicators still empty: DB insert issue (check indicatorService logs)

**P6-PROD-10** will implement the actual fix based on the captured evidence.
