# P3-10E.31 — Metric Extraction & Leadership Input Remediation

## 1. Executive Summary

P3-10E.31 remediated two issues discovered by P3-10E.30:

| Issue | Component | Root Cause | Remediation |
|---|---|---|---|
| Metric key mismatch | Orchestrator | `extractMetricValue()` used underscore-prefixed names (`momentum_7d`, `relativeStrength_7d`) instead of canonical camelCase (`momentum7d`, `relativeStrength7d`) | Fixed metric names in orchestrator; exported `extractMetricValue` for testing |
| Coin 11 Leadership exclusion | P3-06 / Leadership | Coin 11 (AKTUSDT) has no market cap data in production; P3-06 excludes it for `missing_market_cap`, leaving only 2 RS-valid constituents for Leadership | **Classified as DATA GAP (B) + CONTRACT ISSUE (D)**. No code fix; documented. |

**STATUS: PASS (partial)**

The metric extraction bug is fixed and regression-tested. The Leadership coin 11 issue is a genuine production data gap that cannot be resolved by code changes alone. **P3-10E.30 remains BLOCKED** until market cap data for coin 11 is backfilled or the Leadership minimum requirement is adjusted via approved design.

---

## 2. Files Modified

| File | Change Type | Description |
|---|---|---|
| `src/lib/p3/orchestrator.ts` | Modified | Fixed 3 `extractMetricValue` calls to use canonical metric keys; exported `extractMetricValue` for testing |
| `src/lib/p3/__tests__/extract-metric-value.test.ts` | Created | 9 regression tests for metric extraction |

---

## 3. PART A — Metric Key Bug Fix

### 3.1 Root Cause

The orchestrator's `extractMetricValue()` helper was called with incorrect metric names:

| Line | Incorrect Name | Correct Name |
|---|---|---|
| 252 | `"momentum_7d"` | `"momentum7d"` |
| 254 | `"relativeStrength_7d"` | `"relativeStrength7d"` |
| 287 | `"relativeStrength_7d"` | `"relativeStrength7d"` |

The actual metric keys produced by P3-05 and P3-06 are camelCase without underscores:
- P3-05 Momentum: `momentum1d`, `momentum3d`, `momentum7d`, `momentum14d`, `acceleration`
- P3-06 Relative Strength: `relativeStrength1d`, `relativeStrength3d`, `relativeStrength7d`, `relativeStrength14d`

Because `extractMetricValue()` looks up `result.metrics[metricName]`, the underscore-prefixed names returned `undefined`, causing the function to return `null` for both `momentum` and `relativeStrength` inputs to Regime and Rotation.

### 3.2 Code Changes

**File:** `src/lib/p3/orchestrator.ts`

```typescript
// Before (lines 252, 254, 287):
momentum: extractMetricValue(momentumResult, "momentum_7d"),
relativeStrength: extractMetricValue(relativeStrengthResult, "relativeStrength_7d"),

// After:
momentum: extractMetricValue(momentumResult, "momentum7d"),
relativeStrength: extractMetricValue(relativeStrengthResult, "relativeStrength7d"),
```

Also exported `extractMetricValue` for direct testing:

```typescript
// Before:
function extractMetricValue(result: P3CalculationResult, metricName: string): number | null {

// After:
export function extractMetricValue(result: P3CalculationResult, metricName: string): number | null {
```

### 3.3 Verification

After the fix, the orchestrator correctly passes:
- `momentum: 14.03` (from P3-05 `momentum7d`)
- `relativeStrength: -0.0112` (from P3-06 `relativeStrength7d`)
- `acceleration: 4.98` (from P3-05 `acceleration`)

### 3.4 Regression Tests

**File:** `src/lib/p3/__tests__/extract-metric-value.test.ts`

| # | Test | Result |
|---|---|---|
| 1 | Extracts canonical `momentum7d` | PASS |
| 2 | Extracts canonical `relativeStrength7d` | PASS |
| 3 | Rejects legacy `momentum_7d` | PASS |
| 4 | Rejects legacy `relativeStrength_7d` | PASS |
| 5 | Returns null when canonical metric is absent | PASS |
| 6 | Returns null when metric state is not VALID | PASS |
| 7 | Returns null when metric value is null | PASS |
| 8 | Parses string metric values to numbers | PASS |
| 9 | Returns null for non-numeric string values | PASS |

---

## 4. PART B — Leadership Coin 11 Exclusion Audit

### 4.1 Investigation

Traced coin 11 (AKTUSDT) through the complete P3-06 pipeline:

| Stage | Coin 11 Status | Details |
|---|---|---|
| Membership | **ELIGIBLE** | Part of authoritative snapshot 2 |
| Canonical instrument | **OK** | `AKTUSDT` — matches `^[A-Z0-9]+USDT$` |
| Market cap | **MISSING** | `coin_metrics.market_cap = null` for coin 11 |
| Price data | **OK** | 209 records from 2026-01-15 to 2026-08-11 |
| RS calculation | **EXCLUDED** | Reason: `missing_market_cap` |
| Leadership preparation | **INCLUDED** | Has health (26.5), volume (5.79M), return (-7.95%) |
| Leadership RS | **null** | Cannot inherit P3-06 RS because coin 11 was excluded |

### 4.2 Classification

**PRIMARY: B. DATA GAP**

- Required canonical data (market cap from CoinMetrics/Coingecko) genuinely does not exist for coin 11 in production.
- The `coin_metrics` table contains multiple rows for coin 11, but all have `market_cap = null`.
- This is not a code bug — the P3-06 market cap filter correctly identifies missing data.
- This is not an instrument/canonicalization issue — `AKTUSDT` is a valid canonical perpetual instrument.

**SECONDARY: D. CONTRACT ISSUE**

- Leadership eligibility criteria do not require market cap (only health, volume, 7D return, and RS).
- P3-06 RS eligibility requires market cap.
- Leadership depends on P3-06 RS for `relativeStrength7d`.
- Result: A constituent can be Leadership-eligible but RS-ineligible, causing Leadership to fail with INSUFFICIENT_HISTORY when too many constituents share this gap.

### 4.3 Impact on P3-10E.30

With the metric key bug fixed (Part A), the current state for AI/7D would be:

| Stage | Expected | Actual (with fix) |
|---|---|---|
| P3-04 Breadth | VALID | VALID |
| P3-05 Momentum | VALID | VALID |
| P3-06 Relative Strength | VALID | VALID (3 constituents: 1, 4, 5) |
| P3-07 Leadership | VALID | **INSUFFICIENT_HISTORY** (2 RS-valid constituents: 4, 5) |
| P3-08 Regime | VALID | VALID (with fix) |
| P3-09 Rotation | VALID | **MISSING** (3 missing inputs: breadthMomentum, relativeStrength, oiConfirmation) |

**P3-10E.30 remains BLOCKED** due to:
1. Leadership: Only 2 of 3 required constituents have valid RS (coin 11 missing market cap)
2. Rotation: `oiConfirmation` is null (insufficient OI data), `relativeStrength` is null (same root cause as Leadership), `breadthMomentum` is null (no VALID historical baseline)

### 4.4 What Would Unblock

| Blocker | Required Action | Authority |
|---|---|---|
| Coin 11 market cap | Backfill market cap data for AKTUSDT | Data team / external API |
| Leadership minimum | Adjust minimum eligible constituents from 3 to 2 | Separate approved design required |
| Rotation oiConfirmation | Ensure sufficient OI data for eligible constituents | Data availability |
| Rotation relativeStrength | Depends on Leadership fix | Dependent |

---

## 5. PART C — Rotation First-Run Inputs

### 5.1 Approved Contract (from P3-10E.29)

During first run (`firstRun === true`), Rotation may proceed with **exactly one missing input: `breadthMomentum`**.

| Input | Required on First Run | Reason |
|---|---|---|
| `healthMomentum` | **YES** | Derived from narrative_health, always available |
| `breadthMomentum` | **NO** | No VALID historical P3 baseline |
| `relativeStrength` | **YES** | Fallback to current P3-06 RS exists in orchestrator |
| `volumeExpansion` | **YES** | Derived from market_price_daily volume |
| `oiConfirmation` | **YES** | Derived from open interest data |

### 5.2 Current AI/7D Rotation Input Readiness

| Input | Available | Source | Notes |
|---|---|---|---|
| `healthMomentum` | YES (85.07) | narrative_health | Normalized from health change |
| `breadthMomentum` | NO | p3_narrative_intelligence | No VALID historical baseline |
| `relativeStrength` | NO | P3-06 fallback | P3-06 excludes coins 10, 11, 12, 22; only 3 constituents have RS, but coin 11 Leadership gap affects downstream |
| `volumeExpansion` | YES (57.89) | market_price_daily | Normalized from volume ratio |
| `oiConfirmation` | NO | Open interest data | Insufficient OI records for eligible constituents |

**Missing: 3 inputs** (`breadthMomentum`, `relativeStrength`, `oiConfirmation`)

The P3-10E.29 first-run bootstrap only allows `breadthMomentum` to be missing. With 3 missing inputs, Rotation returns `MISSING`.

---

## 6. Test Results

### 6.1 New Tests

| File | Tests | Result |
|---|---|---|
| `extract-metric-value.test.ts` | 9 | 9 passed |

### 6.2 Focused Existing Tests

| File | Tests | Result |
|---|---|---|
| `momentum.test.ts` | All | PASS |
| `relative-strength.test.ts` | All | PASS |
| `orchestrator-gate.test.ts` | All | PASS |
| `regime.test.ts` | All | PASS |
| `leadership.test.ts` | All | PASS |

### 6.3 Full P3 Test Suite

| Metric | Value |
|---|---|
| Total suites | 20 |
| Passed | 16 |
| Failed | 4 |
| New failures introduced | **0** |
| Pre-existing failures | 9 (rotation normalization, membership mock, preparation snapshotId, breadth null) |

---

## 7. Verification

### 7.1 Typecheck

```bash
npx tsc --noEmit
```

**Result: PASS** (no errors)

### 7.2 Git Diff Check

```bash
git diff --check
```

**Result: PASS** (no whitespace errors)

---

## 8. Production Mutation Audit

| Audit Item | Status |
|---|---|
| Production data modified | **NONE** |
| Production schema modified | **NONE** |
| Migrations created | **NONE** |
| `/api/refresh` modified | **NONE** |
| Scheduler modified | **NONE** |
| Thresholds/configuration modified | **NONE** |
| Correction ledger modified | **NONE** |
| Snapshot 7 modified | **NONE** |
| Intelligence #1 modified | **NONE** |
| Authoritative P3 executed | **NONE** |
| New P3 artifacts created | **NONE** |

**Production mutations: 0**

---

## 9. Remaining Blockers for P3-10E.30

| # | Blocker | Stage | Classification | Fix Required |
|---|---|---|---|---|
| 1 | Metric key mismatch | P3-08, P3-09 | **FIXED** | Code fix applied |
| 2 | Coin 11 missing market cap | P3-07 | **DATA GAP (B)** | Backfill market cap data |
| 3 | Coin 11 contract mismatch | P3-07 | **CONTRACT ISSUE (D)** | Approved design change required |
| 4 | Rotation oiConfirmation missing | P3-09 | **DATA GAP** | Ensure OI data availability |
| 5 | Rotation relativeStrength missing | P3-09 | **DEPENDENT** | Depends on Leadership/P3-06 fix |

---

## 10. Is P3-10E.30 Ready to Retry?

**NO.**

Fixing the metric key bug (Issue #1) is necessary but not sufficient. The remaining blockers are:

1. **Leadership cannot reach VALID** because only 2 of 3 required constituents have valid RS data. This requires either:
   - Backfilling market cap data for coin 11 (AKTUSDT), OR
   - An approved design change to reduce Leadership's minimum eligible constituent count

2. **Rotation cannot reach VALID** because `oiConfirmation` is missing and `relativeStrength` depends on Leadership/P3-06.

Until these data gaps are resolved or the Leadership contract is formally revised, **P3-10E.30 must remain BLOCKED**.

---

## 11. Summary

| Task | Status |
|---|---|
| Fix metric key bug | **COMPLETED** |
| Export `extractMetricValue` | **COMPLETED** |
| Add regression tests | **COMPLETED** (9 new tests) |
| Trace coin 11 exclusion | **COMPLETED** |
| Classify coin 11 issue | **B + D** (Data gap + Contract mismatch) |
| Document Rotation first-run | **COMPLETED** |
| Typecheck | **PASS** |
| Diff check | **PASS** |
| Production mutations | **0** |
| P3-10E.30 ready to retry | **NO** — remains BLOCKED |
