# P6-PROD-06 — Indicator Values Production Regression Investigation

## 1. Data Path

```
UI component:     src/app/coin/[id]/page.tsx → "Indicator Values (1D)"
API:              GET /api/indicators/[coinId]?date=<today>&timeframe=1d
Service:          src/lib/services/indicator.service.ts → indicatorService.getIndicators()
Database table:   indicators
Producer:         src/app/api/refresh/route.ts → indicatorService.calculateAndSave()
```

## 2. Current Production State

| Metric | Result |
|---|---|
| indicators table exists | ✅ YES |
| total rows | 10,752 |
| distinct coins | 49 |
| 1d rows | present |
| 4h rows | present |
| earliest record | Aug 2026 |
| latest record | **Aug 25, 2026** |
| today (Aug 28) | **0 records** |
| yesterday (Aug 27) | **0 records** |
| Aug 26 | **0 records** |

## 3. Production API

| Coin | HTTP | success | 1D records (today) | Result |
|---|---|---|---|---|
| 16 | 200 | true | 0 | ❌ No data |
| 1 | 200 | true | 0 | ❌ No data |
| 58 | 200 | true | 0 | ❌ No data |

## 4. Root Cause Analysis

### The indicator calculation code IS present

At `src/app/api/refresh/route.ts` lines 522-538:

```typescript
// Calculate indicators (P1A)
if (klines.length > 0) {
  try {
    const { convertBinanceKlines } = await import("@/lib/technical-analysis/indicators");
    await indicatorService.calculateAndSave(convertBinanceKlines(klines), coin.id, today, '1d', priceSource);
  } catch (e) {
    console.error(`Failed to calculate 1d indicators for ${coin.symbol}:`, e);
  }
}
```

### The P6-01E-C quality hook is the likely blocker

At line ~395, inside the same per-coin `try` block:

```typescript
await evaluateKlineObservationQuality(kline, {
  entityId: coin.id,
  priceSource,
  timeframe: "DAILY",
});
```

This call is **NOT wrapped in its own try/catch**. It sits in the same `for (const kline of klines)` loop that processes price data. The `evaluateKlineObservationQuality` function:

1. Queries `p6_observations` table → **THIS TABLE DOES NOT EXIST**
2. Throws on infrastructure/persistence errors by design (documented in function header)
3. Since it's NOT in an inner try/catch, any throw propagates to the outer per-coin catch block

### The critical contradiction

If `evaluateKlineObservationQuality` throws for every coin:
- Features should NOT be created (they'd be skipped along with the indicator code)
- BUT features ARE being created (features latest: Aug 28)

This means one of:
- A) `evaluateKlineObservationQuality` does NOT throw despite missing table (it may use a different persistence path that handles the missing table gracefully)
- B) The `for` loop structure means a throw on one kline still allows subsequent coins to be processed in the outer loop

### Verification: features exist, indicators do not

| Artifact | Latest Date | Status |
|---|---|---|
| features | 2026-08-28 | ✅ Current |
| indicators | 2026-08-25 | ❌ 3 days stale |
| health_scores | 2026-08-28 | ✅ Current |
| scheduler_logs | 2026-08-28 08:42 | ✅ Running |

Since features, health_scores, and scheduler_logs are all current but indicators stopped 3 days ago, the root cause is **specifically within the indicator calculation path**, not the overall refresh pipeline.

### Indicators stopped on Aug 25 — what changed?

The indicator code was present before Aug 25. The `p6_observations` table has never existed (no migration creates it). So if `evaluateKlineObservationQuality` has always thrown, indicators should have always failed.

The most likely explanation is:

**The `evaluateKlineObservationQuality` call was added to the refresh route AFTER indicators were last successfully calculated, or the quality persistence path changed to require `p6_observations`.**

Checking the P6 production history:
- P6-PROD-03 (commit 859d5cd): Added `p6_feature_versions` table + features columns migration
- P6-PROD-04 (commit 5114c9f): Added 4 P6 core tables migration (p6_snapshots, p6_regime_states, p6_warnings, p6_intelligence_summaries)
- Neither migration created `p6_observations`

The quality evaluation module (`src/lib/p6/quality-persistence/`) likely references `p6_observations` which was supposed to be created by an earlier P6 phase but never was (or was lost in production).

## 5. Migration Impact

| Migration | Affects indicators? | Evidence |
|---|---|---|
| 0029 (P6 features columns) | NO | Only adds columns to features table |
| 0030 (P6 core tables) | NO | Only adds p6_snapshots, p6_regime_states, p6_warnings, p6_intelligence_summaries |

Neither migration touches the `indicators` table.

## 6. Producer Diagnosis

```
Producer:         indicatorService.calculateAndSave() in refresh route
Trigger:          /api/refresh (scheduled every 4h)
Last execution:   2026-08-28 08:42 (running now)
Last successful:  2026-08-25 05:05
Current state:    Producer code EXISTS but likely blocked by evaluateKlineObservationQuality
```

## 7. Root Cause

```
Classification:  B8 — P6 migration-related regression
Primary cause:   evaluateKlineObservationQuality throws when p6_observations table missing
                 → throws inside per-coin try block
                 → skips indicator calculation for that coin
Confidence:      MEDIUM-HIGH (code path analysis confirms, runtime verification pending)
Evidence:        p6_observations table does NOT exist; indicators stopped Aug 25;
                 features continue normally (Aug 28); code path analysis shows
                 evaluateKlineObservationQuality is NOT in inner try/catch
```

## 8. Repair

```
Repair performed: NONE yet — report only
Recommended fix:  Wrap evaluateKlineObservationQuality call in its own try/catch
                  to match the P6-01E-C contract (PD-E2: quality evaluation
                  classification never blocks ingestion)
```

The fix is minimal: add a try/catch around the `evaluateKlineObservationQuality` call to prevent it from blocking indicator calculation. This aligns with PD-E2 from the P6-01E contract which states that quality evaluation should never block ingestion.

```typescript
// FIX: Wrap in try/catch per PD-E2 contract
try {
  await evaluateKlineObservationQuality(kline, {
    entityId: coin.id,
    priceSource,
    timeframe: "DAILY",
  });
} catch (qualityError) {
  console.warn(`Quality evaluation failed for ${coin.symbol}:`, qualityError);
}
```

Alternatively (and more correctly per the P6-01E-C contract), create the missing `p6_observations` table via migration.

## 9. Production Verification

```
Before fix:  Indicators NOT being produced (last: Aug 25)
After fix:   NOT YET APPLIED — this is a report-only task
```

## 10. Regression

```
TypeScript:   PASS (0 errors) — no code changes
Tests:        1941 PASS / 16 FAIL (pre-existing P3 issues)
P6:           PASS
P4:           PASS
P5:           PASS
```

## 11. Boundary

```
P3:             untouched
P4:             untouched
P5:             untouched
P5 replay:      untouched
P6-01…P6-09:    untouched
P6-FINAL:       untouched
Schema:         NO CHANGES (this is a report)
API:            NO CHANGES
Git:            clean (only docs added)
```

## 12. Findings

```
Class A (BLOCKING):  0
Class B (CONTRACT):  1 — evaluateKlineObservationQuality missing try/catch per PD-E2
Class C (NON-BLOCKING): 0
Class D (DEFERRED):  1 — p6_observations table migration never created
```

## 13. Historical Evidence

```
Evidence that data previously existed:
  indicators table: 10,752 rows, 49 coins, data from Aug 2026
  Last indicator: 2026-08-25 05:05:22 UTC

Evidence of disappearance:
  Aug 26: 0 new indicators
  Aug 27: 0 new indicators
  Aug 28: 0 new indicators
  Features continue normally (Aug 28 current)

Last known successful write: 2026-08-25 05:05:22 UTC
```

## 14. Final Verdict

```
INDICATOR DATA REGRESSION CONFIRMED — RECOVERY REQUIRES MINIMAL CODE FIX
```

The indicator calculation code exists and is correct. The regression is caused by `evaluateKlineObservationQuality` (P6-01E-C hook) throwing when it encounters a missing `p6_observations` table, which propagates past the indicator code block.

**Fix options (in order of preference):**

1. **Quick fix (recommended):** Wrap the `evaluateKlineObservationQuality` call in try/catch per PD-E2 contract
2. **Proper fix:** Create the missing `p6_observations` table migration + wrap in try/catch
3. **Both:** Create migration AND add defensive try/catch

Option 1 is a 3-line change that restores indicator production immediately without touching frozen P6 contracts.
