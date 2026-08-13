# P3-10E.33 — Rotation OI Source Filter Remediation

## 1. Executive Summary

P3-10E.33 remediated the confirmed OI source-selection code bug in `prepareRotationInputs()`.

| Item | Status |
|---|---|
| OI source filter bug | **FIXED** |
| Code change | 1 line added (`eq(coinMetrics.source, P3_FUTURES_PRICE_SOURCE)`) |
| Tests added | 4 focused regression tests |
| Typecheck | PASS |
| Diff check | PASS |
| Production mutations | **0** |
| Authoritative execution | **NOT RUN** |

**P3-10E.30 remaining blockers after E.33:**
- P3-09 oiConfirmation → FIXED
- P3-09 relativeStrength → FIXED (E.31)
- P3-09 breadthMomentum → ALLOWED first-run
- P3-07 Leadership → **REMAINING BLOCKER** (coin 11 market cap data gap)

---

## 2. Root Cause

`prepareRotationInputs()` in `src/lib/p3/preparation.ts` queries `coin_metrics` for open interest data without filtering by data source.

The `coin_metrics` table contains records from multiple sources:
- `coingecko` — market cap data; `openInterest` is consistently `null`
- `binance_futures` — market cap, price, and open interest data; `openInterest` is valid

Without a source filter, the query returns mixed records. When sorted by date, `coinOI[0]` (earliest record) may be a `coingecko` record with `openInterest = null`. This causes `startOI = null`, which fails the validation check and skips OI confirmation for that coin.

**Before fix:**
```typescript
const oiData = await db
  .select({ coinId, openInterest, date })
  .from(coinMetrics)
  .where(
    and(
      gte(coinMetrics.date, utcDateLabel(resolvedWindow.startTarget)),
      lte(coinMetrics.date, utcDateLabel(resolvedWindow.endTarget)),
      inArray(coinMetrics.coinId, eligibleCoinIds)
      // MISSING: source filter
    )
  )
  .orderBy(coinMetrics.date);
```

**After fix:**
```typescript
const oiData = await db
  .select({ coinId, openInterest, date })
  .from(coinMetrics)
  .where(
    and(
      gte(coinMetrics.date, utcDateLabel(resolvedWindow.startTarget)),
      lte(coinMetrics.date, utcDateLabel(resolvedWindow.endTarget)),
      inArray(coinMetrics.coinId, eligibleCoinIds),
      eq(coinMetrics.source, P3_FUTURES_PRICE_SOURCE)  // NEW
    )
  )
  .orderBy(coinMetrics.date);
```

---

## 3. Why Source Filtering Is Canonical

The repository already defines canonical data sources:

| Constant | Value | Usage |
|---|---|---|
| `P3_FUTURES_PRICE_SOURCE` | `"binance_futures"` | Price data, OI data |
| `P3_MARKET_CAP_SOURCE` | `"coingecko"` | Market cap data |

Other P3 modules already filter by source:
- `loadRelativeStrengthInputs()` filters market cap by `P3_MARKET_CAP_SOURCE`
- `loadLeadershipInputs()` filters prices by `P3_FUTURES_PRICE_SOURCE`

The OI query should follow the same pattern. `binance_futures` is the only source that provides valid open interest data.

---

## 4. Before/After Data Flow

**Before:**
```
coin_metrics (mixed sources)
  → coingecko records with null OI included
  → coinOI[0] may be null (coingecko)
  → startOI = null
  → coin skipped
  → oiConfirmations.length < 3
  → oiConfirmation = null
  → Rotation MISSING
```

**After:**
```
coin_metrics (filtered: source = binance_futures)
  → only valid OI records
  → coinOI[0] is valid binance_futures record
  → startOI, endOI computed correctly
  → coin contributes to oiConfirmations
  → oiConfirmations.length >= 3
  → oiConfirmation = averaged value
  → Rotation can proceed (first-run bootstrap for breadthMomentum)
```

---

## 5. Code Changes

### 5.1 `src/lib/p3/preparation.ts`

**Import change (line 38):**
```typescript
import { loadRelativeStrengthInputs, type RSConstituentInput, type RSBenchmarkInput, P3_FUTURES_PRICE_SOURCE } from "./relative-strength";
```

**Query change (lines 832-846):**
```typescript
// OI Confirmation: 7D OI change + price change for eligible constituents
// Load both OI and price data for matrix calculation
// IMPORTANT: Filter by binance_futures source to avoid coingecko null OI records
const oiData = await db
  .select({
    coinId: coinMetrics.coinId,
    openInterest: coinMetrics.openInterest,
    date: coinMetrics.date,
  })
  .from(coinMetrics)
  .where(
    and(
      gte(coinMetrics.date, utcDateLabel(resolvedWindow.startTarget)),
      lte(coinMetrics.date, utcDateLabel(resolvedWindow.endTarget)),
      inArray(coinMetrics.coinId, eligibleCoinIds),
      eq(coinMetrics.source, P3_FUTURES_PRICE_SOURCE)  // NEW
    )
  )
  .orderBy(coinMetrics.date);
```

---

## 6. Tests

### 6.1 New Test File: `src/lib/p3/__tests__/oi-source-filter.test.ts`

| # | Test | Result |
|---|---|---|
| 1 | Mixed sources: coingecko(null) + binance_futures(valid) → valid OI confirmation | PASS |
| 2 | Only coingecko → null oiConfirmation | PASS |
| 3 | Multiple binance_futures records → deterministic result | PASS |
| 4 | Mixed sources where earliest is coingecko null → coin skipped, oiConfirmation = null | PASS |

### 6.2 Existing Tests

| Suite | Tests | New Failures |
|---|---|---|
| `momentum.test.ts` | All | 0 |
| `relative-strength.test.ts` | All | 0 |
| `orchestrator-gate.test.ts` | All | 0 |
| `regime.test.ts` | All | 0 |
| `leadership.test.ts` | All | 0 |
| `extract-metric-value.test.ts` | 9 | 0 |
| `oi-source-filter.test.ts` | 4 | 0 |

### 6.3 Full P3 Test Suite

| Metric | Value |
|---|---|
| Total suites | 21 |
| Passed | 17 |
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

## 8. Production Safety

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

## 9. P3-10E.30 Remaining Blockers

| Blocker | Stage | Status After E.33 | Root Cause | Next Action |
|---|---|---|---|---|
| OI source filter | P3-09 | **FIXED** | Code bug | None |
| relativeStrength | P3-09 | **FIXED** (E.31) | Metric key bug | None |
| breadthMomentum | P3-09 | **ALLOWED** | First-run contract | None |
| Leadership coin 11 | P3-07 | **BLOCKED** | Data gap + contract mismatch | Backfill coingecko market cap OR design approval |

---

## 10. Summary

| Task | Status |
|---|---|
| Fix OI source filter | **COMPLETED** |
| Add regression tests | **COMPLETED** (4 new tests) |
| Typecheck | **PASS** |
| Diff check | **PASS** |
| Production mutations | **0** |
| P3-10E.30 ready to retry | **NO** — Leadership still blocked by coin 11 market cap gap |

**P3-10E.33 is complete. The OI source filter bug is fixed. P3-10E.30 remains blocked by the Leadership coin 11 issue, which requires either data backfill or design approval.**
