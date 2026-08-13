# P3-10E.32 — Leadership & Rotation Blocker Audit

## 1. Executive Summary

P3-10E.32 is a **read-only audit** of the remaining blockers after P3-10E.31.

| Stage | Blocker | Classification | Remediation Type |
|---|---|---|---|
| P3-07 Leadership | Coin 11 (AKTUSDT) lacks coingecko market cap | **B + D** (Data gap + Contract mismatch) | Data backfill or design approval |
| P3-09 Rotation relativeStrength | Metric key bug | **FIXED in E.31** | None |
| P3-09 Rotation oiConfirmation | OI query picks up null coingecko records | **A** (Code bug) | Minimal code fix |
| P3-09 Rotation breadthMomentum | No VALID historical baseline | Expected first-run behavior | None |

**P3-10E.30 remains BLOCKED** until coin 11 market cap issue is resolved.

**No production data was modified. No orchestrator was executed.**

---

## 2. PART A — Leadership Blocker

### 2.1 Dependency Chain

```
P3-06 RS
  → requires marketCapAvailable = true
  → coin_metrics.market_cap IS NOT NULL AND > 0, source = 'coingecko'
  ↓
Leadership RS input (relativeStrength7d)
  → requires constituent to have valid RS from P3-06
  ↓
minimum eligible constituents = 3
  ↓
P3-07 VALID
```

### 2.2 Coin 11 (AKTUSDT) Trace

| Stage | Status | Evidence |
|---|---|---|
| Membership | ELIGIBLE | Part of authoritative snapshot 2 |
| Canonical instrument | OK | `AKTUSDT` matches `^[A-Z0-9]+USDT$` |
| Market cap (coingecko) | **MISSING** | All 11 coingecko records for coin 11 have `market_cap = null` |
| Market cap (binance_futures) | **AVAILABLE** | 11 records from 2026-08-02 to 2026-08-12, values ~139M–153M |
| Price data | OK | 209 records from 2026-01-15 to 2026-08-11 |
| RS calculation | **EXCLUDED** | Reason: `missing_market_cap` |
| Leadership preparation | INCLUDED | Has health (26.5), volume (5.79M), return (-7.95%) |
| Leadership RS | **null** | Cannot inherit P3-06 RS |

### 2.3 Why Coin 11 Lacks coingecko Market Cap

The `coin_metrics` table contains market cap data from TWO sources:
- `coingecko`: authoritative source per `P3_MARKET_CAP_SOURCE = "coingecko"`
- `binance_futures`: alternative source with daily market cap data

For coins 1, 4, 5: both sources have data (coingecko from 2026-07-31, binance_futures from 2026-08-02 onwards).
For coin 11: **only binance_futures has data**. Coingecko has 11 records, all with `market_cap = null`.

### 2.4 Classification

**PRIMARY: B. DATA GAP**

The canonical coingecko source genuinely lacks market cap data for coin 11 (AKTUSDT). The P3-06 code correctly implements the design intent by filtering `source = 'coingecko'`. This is not a code bug — the code is working as designed.

**SECONDARY: D. CONTRACT ISSUE**

Leadership eligibility does NOT require market cap (checks: instrument, health, volume, 7D return). However, Leadership depends on P3-06 RS for `relativeStrength7d`, and P3-06 RS DOES require market cap. This creates an incompatibility: a constituent can be Leadership-eligible but RS-ineligible.

### 2.5 Can Coin 11 Get RS Without Changing P3-06 Semantics?

No. Options:

| Option | Feasibility | Notes |
|---|---|---|
| Backfill coingecko market cap | Not allowed in this task | Requires external data |
| Accept binance_futures market cap | Requires design approval | Changes `P3_MARKET_CAP_SOURCE` semantics |
| Calculate RS without market cap | Violates P3-06 contract | Market cap is an intentional eligibility filter |
| Reduce Leadership minimum 3→2 | Not allowed in this task | Requires owner/design approval |

### 2.6 Impact on P3-10E.30

With E.31 fix + OI bug fix (if implemented), AI/7D would have:

| Stage | Expected | Actual |
|---|---|---|
| P3-04 Breadth | VALID | VALID |
| P3-05 Momentum | VALID | VALID |
| P3-06 RS | VALID | VALID (3 constituents: 1, 4, 5) |
| P3-07 Leadership | VALID | **INSUFFICIENT_HISTORY** (2 RS-valid: 4, 5) |
| P3-08 Regime | VALID | VALID (after E.31 fix) |
| P3-09 Rotation | VALID | VALID (after OI fix + E.31 fix) |

---

## 3. PART B — Rotation relativeStrength Dependency

### 3.1 Dependency Chain

```
P3-06 calculateRelativeStrengthResult()
  → metrics.relativeStrength7d (narrative-level aggregate)
  → provenance.constituentReturns7d (per-coin returns, added in E.29)
    ↓
orchestrator.ts rotation inputs (lines 284-289)
  ↓
  if rotationInputs.relativeStrength != null
    → use preparation layer value (historical P3 baseline)
  else
    → extractMetricValue(relativeStrengthResult, "relativeStrength7d")
    → normalizeRelativeStrength(value)
    ↓
RotationInputs.relativeStrength
```

### 3.2 Current State

**P3-10E.31 fixed the metric key bug.** The orchestrator now correctly calls:
```typescript
extractMetricValue(relativeStrengthResult, "relativeStrength7d")
```

This returns the narrative-level 7D RS value (-0.0112 for AI/7D), which is then normalized to ~49.94.

### 3.3 Is relativeStrength a Blocker?

**NO** — after E.31, `relativeStrength` is correctly populated for Rotation via the fallback path. The only scenario where it would be null is if P3-06 itself returns non-VALID, which is not the case for AI/7D.

---

## 4. PART C — Rotation oiConfirmation Dependency

### 4.1 Dependency Chain

```
coin_metrics.openInterest
  ↓
prepareRotationInputs() OI query (lines 832-846)
  ↓
NO source filter → returns mixed coingecko (null OI) + binance_futures (valid OI) records
  ↓
coinOI array sorted by date
  ↓
startOI = coinOI[0].openInterest  ← MAY BE NULL (coingecko record)
endOI = coinOI[last].openInterest  ← MAY BE VALID (binance_futures record)
  ↓
if (startOI != null && endOI != null && ...)
  → FALSE because startOI is null
  ↓
oiConfirmation skipped for this coin
  ↓
oiConfirmations.length < 3
  ↓
oiConfirmation = null
```

### 4.2 Root Cause

**CODE BUG (A)** — The OI query in `prepareRotationInputs()` does NOT filter by data source:

```typescript
// preparation.ts lines 832-846
const oiData = await db
  .select({ coinId, openInterest, date })
  .from(coinMetrics)
  .where(
    and(
      gte(coinMetrics.date, ...),
      lte(coinMetrics.date, ...),
      inArray(coinMetrics.coinId, eligibleCoinIds)
      // MISSING: eq(coinMetrics.source, ...)
    )
  )
  .orderBy(coinMetrics.date);
```

Compare with the market cap query in `loadRelativeStrengthInputs()`:
```typescript
const capRows = await db.select({...})
  .from(coinMetrics)
  .where(and(
    inArray(coinMetrics.coinId, allIds),
    eq(coinMetrics.source, P3_MARKET_CAP_SOURCE),  // ← HAS source filter
    lte(coinMetrics.date, end)
  ));
```

### 4.3 Evidence

Audit of `coin_metrics` for AI constituents:

| Coin | coingecko OI | binance_futures OI |
|---|---|---|
| 1 | null (13 records) | Valid (13 records) |
| 4 | null (13 records) | Valid (13 records) |
| 5 | null (13 records) | Valid (13 records) |
| 10 | null (13 records) | Valid (13 records) |
| 11 | null (11 records) | Valid (11 records) |
| 12 | null (11 records) | Valid (11 records) |
| 22 | null (11 records) | Valid (11 records) |

When the OI query returns mixed-source records sorted by date, `coinOI[0]` (earliest) may be a coingecko record with `openInterest = null`. This causes `startOI = null`, which fails the validation check and skips OI confirmation for that coin.

### 4.4 Required Fix

Add a source filter to the OI query. The canonical source for market data metrics is `coingecko`, but coingecko does NOT provide OI data. The `binance_futures` source provides valid OI data.

**Minimal fix options:**

| Option | Description | Risk |
|---|---|---|
| A1 | Filter OI query by `binance_futures` source | Low — data exists and is valid |
| A2 | Add `P3_OI_SOURCE` constant and filter by it | Low — explicit canonical source |
| A3 | Deduplicate by date, taking latest non-null OI per date | Medium — more complex, may hide data quality issues |

**Recommended: A1 or A2** — explicit source filter, minimal code change.

### 4.5 Impact of Fix

After adding source filter:
- Eligible coins for Rotation: 4, 5, 11
- All 3 have valid OI data from `binance_futures` for the 7D window
- `oiConfirmations.length` = 3
- `oiConfirmation` = non-null averaged value
- Rotation has only `breadthMomentum` missing (allowed for first-run)
- **Rotation becomes VALID**

---

## 5. PART D — Minimal Safe Path to First VALID Run

### 5.1 Dependency Matrix

| Stage | Input | Current State | Root Cause | Minimal Safe Remediation |
|------|------|------|------|------|
| P3-07 | RS for 3 eligible constituents | BLOCKED | Coin 11 lacks coingecko market cap (B) + Leadership/RS contract mismatch (D) | Backfill coingecko data OR accept alternative source |
| P3-09 | relativeStrength | OK after E.31 | Metric key bug | Fixed in E.31 |
| P3-09 | oiConfirmation | BLOCKED | OI query missing source filter (A) | Add source filter to OI query |
| P3-09 | breadthMomentum | MISSING | First-run expected | None |

### 5.2 Path Analysis

**Path 1 — Data-only remediation**
- Requires: Backfill coingecko market cap for AKTUSDT (coin 11)
- Feasibility: Not possible in this task (no production data modification)
- Verdict: **Not available**

**Path 2 — Code bug remediation**
- Fix OI source filter: **Minimal, safe, deterministic**
- Accept binance_futures market cap for RS: **Requires design approval** (changes canonical source semantics)
- Verdict: **OI fix is safe. Market cap source change needs approval.**

**Path 3 — Contract change**
- Reduce Leadership minimum from 3 to 2
- Feasibility: Explicitly prohibited in this task
- Verdict: **Not available without owner approval**

### 5.3 Recommended Option

**Immediate (no approval required):**
1. Fix OI source filter in `prepareRotationInputs()` — this is a clear code bug with a minimal, deterministic fix.

**Deferred (requires approval):**
2. Resolve coin 11 market cap gap:
   - Option A: Backfill coingecko market cap for AKTUSDT (data team)
   - Option B: Expand `P3_MARKET_CAP_SOURCE` to accept `binance_futures` market cap when coingecko is unavailable (design approval required)

**NOT recommended:**
3. Reducing Leadership minimum from 3 to 2 without thorough statistical analysis and owner approval.

### 5.4 Can P3-10E.30 Be Retried?

**NO — not yet.**

After E.31 + OI fix:
- P3-09 Rotation: **VALID** (only breadthMomentum missing, allowed for first-run)
- P3-08 Regime: **VALID** (metric key bug fixed)
- P3-07 Leadership: **INSUFFICIENT_HISTORY** (only 2 RS-valid constituents)

The Leadership blocker requires resolving coin 11's market cap data gap, which is outside the scope of code-only remediation.

---

## 6. Rotation First-Run Contract Analysis

### 6.1 Approved Contract (from P3-10E.29)

| Input | Required on First Run | Source |
|---|---|---|
| `healthMomentum` | **YES** | narrative_health change, normalized |
| `breadthMomentum` | **NO** | Historical P3 breadth change |
| `relativeStrength` | **YES** | P3-06 current RS (fallback in orchestrator) |
| `volumeExpansion` | **YES** | market_price_daily volume ratio |
| `oiConfirmation` | **YES** | coin_metrics OI + price change matrix |

### 6.2 Current AI/7D Input Readiness (after E.31 + OI fix)

| Input | Available | Value | Notes |
|---|---|---|---|
| `healthMomentum` | YES | 85.07 | From narrative health change |
| `breadthMomentum` | NO | null | No VALID historical baseline (expected) |
| `relativeStrength` | YES | ~49.94 | From P3-06 fallback after E.31 fix |
| `volumeExpansion` | YES | ~57.89 | From market_price_daily volume |
| `oiConfirmation` | YES | TBD | After OI source filter fix |

**Missing: 1 input** (`breadthMomentum` only — allowed for first-run)

---

## 7. Production Safety Verification

| Audit Item | Status |
|---|---|
| Production writes | **0** |
| Production mutations | **0** |
| New snapshots created | **0** |
| Snapshot 7 modified | **NO** |
| Intelligence #1 modified | **NO** |
| Correction ledger modified | **NO** |
| P0-P2 tables modified | **NO** |
| Thresholds modified | **NO** |
| `/api/refresh` modified | **NO** |
| Scheduler modified | **NO** |
| Authoritative execution | **NOT RUN** |

---

## 8. Exact Files/Functions Requiring Changes

### 8.1 OI Source Filter Fix (Code Bug A)

**File:** `src/lib/p3/preparation.ts`
**Function:** `prepareRotationInputs()`
**Lines:** 832-846

Current:
```typescript
const oiData = await db
  .select({ coinId, openInterest, date })
  .from(coinMetrics)
  .where(
    and(
      gte(coinMetrics.date, utcDateLabel(resolvedWindow.startTarget)),
      lte(coinMetrics.date, utcDateLabel(resolvedWindow.endTarget)),
      inArray(coinMetrics.coinId, eligibleCoinIds)
    )
  )
  .orderBy(coinMetrics.date);
```

Required: Add `eq(coinMetrics.source, "binance_futures")` or equivalent source filter.

### 8.2 Coin 11 Market Cap (Data Gap B + Contract D)

**Option A — Data backfill (no code change):**
- Backfill `coin_metrics` with coingecko market cap for AKTUSDT (coin 11)
- Requires: External data source, data team action

**Option B — Accept alternative source (code change):**
- **File:** `src/lib/p3/relative-strength.ts`
- **Function:** `loadRelativeStrengthInputs()`
- **Lines:** 167
- Change: Accept market cap from `binance_futures` when `coingecko` is unavailable
- Requires: Design approval (changes canonical source semantics)

**Option C — Contract change (design approval required):**
- Reduce Leadership minimum from 3 to 2
- Requires: Owner approval, statistical analysis

---

## 9. Required Owner Approvals

| Change | Approval Required |
|---|---|
| OI source filter fix | None — bug fix, no semantic change |
| Accept binance_futures market cap | Yes — changes canonical source definition |
| Reduce Leadership minimum 3→2 | Yes — changes P3 master specification |
| Backfill coingecko market cap | Yes — external data procurement |

---

## 10. P3-10E.30 Retry Preconditions

| Precondition | Status | Owner |
|---|---|---|
| E.31 metric key fix | COMPLETED | Engineering |
| OI source filter fix | PENDING | Engineering |
| Coin 11 coingecko market cap backfill | PENDING | Data team |
| OR: Design approval for alternative market cap source | PENDING | Product/Owner |
| OR: Design approval for Leadership minimum change | PENDING | Product/Owner |

**P3-10E.30 can be retried ONLY after:**
1. OI source filter fix is deployed, AND
2. One of the coin 11 market cap resolutions is completed

---

## 11. Summary

| Question | Answer |
|---|---|
| Why is coin 11 missing market cap? | coingecko source has null market cap; binance_futures source has valid data |
| Is there another canonical source? | binance_futures has data, but coingecko is the defined canonical source |
| Is market cap a RS requirement or filter? | Eligibility filter only — RS calculation needs only prices |
| Can coin 11 get RS without changing P3-06? | Not without accepting alternative source or backfilling data |
| Does Leadership need >=3 constituents? | Yes, per current specification |
| Is relativeStrength a Rotation blocker after E.31? | No — fallback to P3-06 works correctly |
| Is oiConfirmation a Rotation blocker? | Yes — OI query missing source filter causes null contamination |
| What is the minimal safe path? | Fix OI filter + resolve coin 11 market cap |
| Can E.30 be retried now? | **NO** — Leadership still blocked by coin 11 market cap gap |
