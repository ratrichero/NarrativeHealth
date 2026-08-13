# P3-10E.34 — Leadership Coin 11 Resolution & Contract Decision

## 1. Executive Summary

P3-10E.34 is a **read-only audit and decision design** task. It does not execute P3, modify production data, or change any P3 contract.

**Single remaining blocker for P3-10E.30:** P3-07 Leadership has only 2 valid RS constituents (coins 4, 5). Coin 11 (AKTUSDT) is ELIGIBLE in the membership snapshot but is EXCLUDED from P3-06 Relative Strength because `coin_metrics.market_cap` is `NULL` for the canonical source `coingecko`.

**Root cause:** The `backend/api/refresh.py` pipeline intentionally does not persist `market_cap` for the `coingecko` source. The comment at line 250 reads `"only FDV, not Market Cap"`. The `CoinGeckoCollector` (`backend/collectors/coingecko.py`) does fetch `market_cap` from the API, but the refresh pipeline discards it.

**Verdict:** `READY FOR DATA REMEDIATION`

The canonical coingecko source is capable of supplying `market_cap`. The gap is in the persistence layer (`refresh.py`), not in the data source or the P3 contract. After the pipeline fix and a single refresh run, coin 11 will have a valid canonical `market_cap` record on or before the window-end date, satisfying P3-06 eligibility without any contract change.

---

## 2. PART A — Coin 11 Data Forensics

### 2.1 All `market_cap` Records for Coin 11

| Source | Date Range | Count | Values |
|--------|-----------|-------|--------|
| `coingecko` | 2026-08-02 → 2026-08-12 | 11 | **All `NULL`** |
| `binance_futures` | 2026-08-02 → 2026-08-12 | 11 | $139.3M → $153.3M |

**Exact values (binance_futures):**

```
2026-08-12  153,286,054
2026-08-11  146,389,581
2026-08-10  147,486,130
2026-08-09  149,782,146
2026-08-08  149,272,488
2026-08-07  145,430,907
2026-08-06  144,471,589
2026-08-05  150,907,564
2026-08-04  148,470,576
2026-08-03  145,779,383
2026-08-02  139,311,507
```

### 2.2 Source Quality Assessment

**`binance_futures` market_cap:**
- Values are stable in the $130M–$160M range for an active Layer-1/Devinfra coin.
- No extreme spikes or zeros.
- Field is populated alongside `open_interest` (also valid).
- `fully_diluted_valuation` is `NULL` for all binance_futures rows.

**`coingecko` records for coin 11:**
- `market_cap` = `NULL` for all 11 rows.
- `fully_diluted_valuation` is populated and closely tracks binance_futures `market_cap`:
  - 2026-08-12: cg FDV = $153,286,657 vs bf market_cap = $153,286,054 (delta = $603, 0.0004%)
  - 2026-08-11: cg FDV = $146,395,665 vs bf market_cap = $146,389,581 (delta = $6,084, 0.004%)
- This near-1:1 correlation strongly indicates the coingecko API is returning `market_cap` data, but the refresh pipeline is choosing not to persist it.

### 2.3 Systemic Pattern

The same pattern exists for **all AI constituents**:

| Coin | coingecko `market_cap` (non-null) | binance_futures `market_cap` |
|------|----------------------------------|------------------------------|
| 1 | 1 record (2026-07-31 only) | 13 records |
| 4 | 1 record (2026-07-31 only) | 13 records |
| 5 | 1 record (2026-07-31 only) | 13 records |
| 10 | 0 records | 13 records |
| 11 | 0 records | 11 records |
| 12 | 0 records | 11 records |
| 22 | 0 records | 11 records |

Coingecko `market_cap` ceased being persisted after 2026-07-31 for coins 1, 4, 5, and was never persisted for coins 10, 11, 12, 22.

### 2.4 Canonical Source Determination

**`coingecko` is the designated canonical market-cap source.**

Evidence:
- `P3_MARKET_CAP_SOURCE = "coingecko"` defined in `src/lib/p3/relative-strength.ts:15`
- `loadRelativeStrengthInputs()` filters by `eq(coinMetrics.source, P3_MARKET_CAP_SOURCE)` (`relative-strength.ts:167`)
- `loadLeadershipInputs()` filters by `eq(coinMetrics.source, P3_MARKET_CAP_SOURCE)` (`leadership.ts:147`)
- `prepareRelativeStrengthInputs()` / `resolveP3Membership()` eligibility checks use the latest `coin_metrics` record without source filter for preparation, but P3-06 calculation filters by `coingecko`
- P3_10B contract: "Market cap exists and is valid → ELIGIBLE" with `missing_market_cap` exclusion reason

**No other canonical market-cap source exists.**

`binance_futures` is designated as the canonical source for:
- Price (`P3_FUTURES_PRICE_SOURCE = "binance_futures"`)
- Open Interest
- Volume

It is NOT designated as a market-cap source. Using it for market cap would require a contract change.

### 2.5 Reconstructability

Historical market cap for the required P3-06 window **can be reconstructed deterministically** if the refresh pipeline is fixed to persist `market_cap` for `coingecko`. The `CoinGeckoCollector` already retrieves `market_cap` from the `/coins/markets` endpoint. No new API integration is required.

---

## 3. PART B — P3-06 Market-Cap Dependency

### 3.1 Why Market Cap Is Required

P3-06 Relative Strength requires market cap **only for eligibility filtering**. The RS calculation itself uses only perpetual-futures price data.

**Reference:** `src/lib/p3/relative-strength.ts`

```typescript
// Line 167-168: Eligibility filter
const capRows = allIds.length ? await db.select({ coinId: coinMetrics.coinId, marketCap: coinMetrics.marketCap })
  .from(coinMetrics)
  .where(and(inArray(coinMetrics.coinId, allIds), eq(coinMetrics.source, P3_MARKET_CAP_SOURCE), lte(coinMetrics.date, end))) : [];
const capEligible = new Set(capRows.filter((row) => row.marketCap != null && Number(row.marketCap) > 0).map((row) => row.coinId));
```

```typescript
// Line 96: Exclusion logic
if (!constituent.marketCapAvailable) { excludedConstituents.push({ coinId: constituent.coinId, reason: "missing_market_cap" }); continue; }
```

### 3.2 Mathematical Requirement

Market cap is **NOT mathematically required** for RS calculation. The RS formula is:

```
relativeStrength = (constituent_return / btc_return) - 1
```

or the per-window classification uses only `end.close / start.close - 1` for both constituent and BTC (`calculateAssetReturn()` at `relative-strength.ts:67-80`).

### 3.3 P3-06 Without Market Cap

If the market-cap filter were removed:
- **Mathematical impact:** None on RS values.
- **P3 specification impact:** Violates P3_10B contract (line 394: "At least 3 eligible constituents with valid market cap").
- **Downstream impact:** P3-07 would receive RS for constituents that P3-06 eligibility previously excluded. This changes the eligible population definition.
- **Test impact:** Existing tests assert `missing_market_cap` exclusion (`relative-strength.test.ts:43`).
- **Risk:** This is a contract change, not a bug fix.

### 3.4 P3-06 Specification on Canonical Source

P3_10B does not name `coingecko` explicitly, but the implementation does via `P3_MARKET_CAP_SOURCE = "coingecko"`. The P3_DATA_CONTRACT (line 183) states: "a constituent must ... have valid market cap". The source is implicit in the code.

---

## 4. PART C — P3-07 Leadership Contract

### 4.1 Eligibility Criteria

From `src/lib/p3/leadership.ts:84-93`:

```typescript
const eligible = constituents.filter((item) => {
  let reason: string | null = null;
  if (!item.marketCapAvailable) reason = "missing_market_cap";
  else if (!canonicalPerpetual(item.instrument)) reason = "missing_canonical_usdt_perpetual";
  else if (!validComponent(item.health)) reason = "missing_or_invalid_health";
  else if (!validComponent(item.volumeScore)) reason = "missing_or_invalid_volume";
  else if (item.coinReturn7d == null || !Number.isFinite(item.coinReturn7d)) reason = "missing_or_invalid_perpetual_history";
  else if (item.relativeStrength7d == null || !Number.isFinite(item.relativeStrength7d)) reason = "missing_or_invalid_relative_strength";
  if (reason) { excluded.push({ coinId: item.coinId, reason }); return false; }
  return true;
});
```

### 4.2 Minimum Eligible Constituent Count

**Hardcoded minimum = 3** (`leadership.ts:100`):

```typescript
if (eligible.length < 3) return { window: LEADERSHIP_WINDOW, availabilityState: "INSUFFICIENT_HISTORY", ... };
```

P3_10B contract (line 420): "At least 3 eligible constituents"
P3_10B contract (line 426): "Insufficient constituents (<3) → INSUFFICIENT_HISTORY"

### 4.3 Why Minimum = 3

The minimum is a statistical robustness threshold. Leadership identifies a single "leader" coin from the eligible population. With fewer than 3 constituents, the ranking lacks statistical reliability and concentration metrics become meaningless.

### 4.4 Documentation of Minimum = 3

- `MIN_VALID_RS_CONSTITUENTS = 3` in `relative-strength.ts:16`
- `minimumEligiblePopulation: 3` in `leadership.ts:100,109`
- P3_10B line 394: "At least 3 eligible constituents with valid market cap"
- P3_10B line 420: "At least 3 eligible constituents"

The minimum is documented in both code and specification.

### 4.5 Leadership's Dependency on P3-06 RS

Leadership requires `relativeStrength7d` for **every eligible constituent** (`leadership.ts:91`). There is **no fallback mechanism**. If P3-06 excludes a constituent, Leadership cannot use an alternate RS source.

The `prepareLeadershipInputs()` function (`preparation.ts:439-557`) receives `relativeStrengthData` from the orchestrator, which is the canonical P3-06 output.

### 4.6 No Fallback Mechanism

There is no fallback RS source in the codebase. Leadership is strictly dependent on P3-06.

---

## 5. PART D — Remediation Options Evaluation

### 5.1 OPTION A — Restore Canonical CoinGecko Market Cap

**Feasibility:** YES

**Evidence:**
1. `CoinGeckoCollector.fetch_markets()` (`backend/collectors/coingecko.py:45-79`) already retrieves `market_cap` from the `/coins/markets` endpoint.
2. The refresh pipeline (`backend/api/refresh.py:250-274`) explicitly skips persisting it: `"only FDV, not Market Cap"`.
3. The `coin_metrics` table schema supports `market_cap` for all sources.

**Exact data source:** `CoinGeckoCollector.fetch_markets()` → `cg_data[coin.coingecko_id]["market_cap"]`

**Required records:** One valid `market_cap` record on or before the P3 window-end date. P3-06 eligibility uses `lte(coinMetrics.date, end)` and only needs existence of a non-null, positive value.

**Deterministic procedure:**
1. Modify `refresh.py` lines 265-273 to also persist `market_cap` for `coingecko` source.
2. Run the refresh endpoint for coin 11 (and all affected coins).
3. P3-06 eligibility check will find the new record.

**Production backfill safety:** No historical backfill is required. P3-06 eligibility only needs the latest record on or before `windowEnd`. A single forward refresh is sufficient.

**Expected result:** Coin 11 becomes `ELIGIBLE` in P3-06, receives a valid 7D RS, and Leadership reaches 3 valid constituents → `VALID`.

**Risk:** Minimal. This restores the originally intended data flow without changing any P3 contract.

### 5.2 OPTION B — Use Existing Canonical Data Under Another Source

**Feasibility:** Technically yes, semantically NO.

**Evidence:**
- `binance_futures` has 11 valid `market_cap` records for coin 11.
- Values are stable and plausible ($139M–$153M).
- However, `P3_MARKET_CAP_SOURCE = "coingecko"` is hardcoded.
- P3_10B contract designates `coingecko` as the authoritative source for market-cap eligibility.
- `binance_futures` is designated for price, OI, and volume.

**Equivalence proof:** Cannot be proven without changing `P3_MARKET_CAP_SOURCE` or adding a fallback clause. The two sources are semantically distinct in the P3 contract.

**Risk:** This is a **CONTRACT CHANGE**. It would require:
- Modifying `P3_MARKET_CAP_SOURCE` to accept multiple sources, OR
- Adding fallback logic in `loadRelativeStrengthInputs()` and `loadLeadershipInputs()`
- Updating P3_10B and P3_DATA_CONTRACT specifications
- Regression testing all market-cap-dependent modules

### 5.3 OPTION C — Remove Market-Cap Requirement from P3-06

**Feasibility:** Yes, but NOT recommended.

**Impact:**
- **Mathematical:** None on RS calculation.
- **P3 specification:** Direct violation. P3_10B line 394: "At least 3 eligible constituents with valid market cap". P3_10B line 588: "Market cap missing → EXCLUDED".
- **Downstream:** Changes eligible population for ALL narratives, not just AI. Affects P3-07, P3-08, P3-09.
- **Test impact:** Breaks tests asserting `missing_market_cap` exclusion.
- **Risk:** High. This weakens the P3 data-quality boundary.

**Classification:** CONTRACT CHANGE.

### 5.4 OPTION D — Reduce Leadership Minimum 3 → 2

**Feasibility:** Technically yes, semantically NO.

**Impact:**
- **Statistical:** Reduces ranking reliability. With 2 constituents, concentration metrics are trivial (top-3 contribution = 100% if both are included).
- **Semantic:** Changes the definition of "leadership" from "top of a robust field" to "top of a minimal field".
- **Specification:** P3_10B line 420: "At least 3 eligible constituents". P3 master spec (`p3.md`) does not explicitly state the minimum, but the implementation and contract documents do.
- **First-run-only relaxation:** Not possible without branching logic. Future runs with 2 constituents would also return `INSUFFICIENT_HISTORY` unless the minimum is permanently changed.

**Classification:** Requires explicit owner approval. Not a code fix.

---

## 6. PART E — First Valid Run Path

### 6.1 Dependency Chain

```
P3-06 Relative Strength
  ├── Requires: 3 constituents with valid market_cap (coingecko)
  ├── Requires: BTCUSDT perpetual futures prices
  ├── Requires: 14D price history for constituents and BTC
  └── Output: per-constituent 7D RS values
         ↓
3 valid RS constituents (coins 4, 5, 11)
         ↓
P3-07 Leadership
  ├── Requires: 3 constituents with valid RS, health, volume, return
  ├── Requires: 7D price history
  └── Output: leaderCoinId, leaderScore, concentration
         ↓
P3-08 Regime
  ├── Requires: valid breadth, momentum, RS, healthChange
  └── Output: regime classification
         ↓
P3-09 Rotation
  ├── Requires: valid RS, OI confirmation, breadthMomentum
  └── Output: rotation weights, target coins
         ↓
Persistence gate
  ├── Requires: VALID results from P3-04 through P3-09
  └── Output: First valid P3 artifact
```

### 6.2 Verification of Current State

After P3-10E.33:

| Module | Status | Blocker |
|--------|--------|---------|
| P3-04 Breadth | VALID | None |
| P3-05 Momentum | VALID | None |
| P3-06 RS | **2 valid constituents** | Coin 11 missing coingecko market_cap |
| P3-07 Leadership | **INSUFFICIENT_HISTORY** | Only 2 valid RS constituents |
| P3-08 Regime | Depends on P3-07 | Blocked by Leadership |
| P3-09 Rotation | Depends on P3-07 | Blocked by Leadership |
| Persistence gate | Depends on all | Blocked |

**Confirmed:** After E.33, the only missing prerequisite is Leadership's third valid RS constituent, which is blocked by coin 11's missing coingecko market_cap.

### 6.3 Regime and Rotation Status

P3-08 Regime and P3-09 Rotation do **not** have independent market-cap blockers. Their inputs (breadth, momentum, RS, OI confirmation) are derived from earlier modules. Once Leadership is VALID, Regime and Rotation should proceed normally.

P3-09 Rotation's first-run `breadthMomentum` baseline was fixed in E.33 to allow `INSUFFICIENT_HISTORY` on first run without blocking the entire chain.

---

## 7. PART F — Recommendation

### 7.1 Recommended Path

**READY FOR DATA REMEDIATION**

### 7.2 Rationale

1. **Preserves P3 specification:** Uses the designated canonical source (`coingecko`). No contract changes.
2. **Prefers canonical data remediation:** The data source is capable; the gap is in the persistence layer.
3. **Minimal deterministic code change:** A 3-line addition to `refresh.py` to persist `market_cap` alongside `fully_diluted_valuation`.
4. **No contract change required:** P3-06 and P3-07 semantics remain intact.

### 7.3 Why Not Other Options

- **Option B (binance_futures):** Requires changing `P3_MARKET_CAP_SOURCE` contract. Rejected.
- **Option C (remove market-cap filter):** Weakens P3 data-quality boundary. Rejected.
- **Option D (reduce minimum):** Changes Leadership semantics. Requires owner approval. Rejected for this task.

---

## 8. PART G — Exact Implementation / Data Scope

### 8.1 Code Change Required

**File:** `backend/api/refresh.py`

**Location:** Lines 265-273

**Current code:**
```python
if cg_metrics:
    cg_metrics.fully_diluted_valuation = str(cgd.get("fully_diluted_valuation")) if cgd.get("fully_diluted_valuation") else None
else:
    db.add(CoinMetrics(
        coin_id=coin.id,
        date=today,
        fully_diluted_valuation=str(cgd.get("fully_diluted_valuation")) if cgd.get("fully_diluted_valuation") else None,
        source="coingecko",
    ))
```

**Required change:** Add `market_cap` persistence:

```python
if cg_metrics:
    cg_metrics.market_cap = str(cgd.get("market_cap")) if cgd.get("market_cap") else None
    cg_metrics.fully_diluted_valuation = str(cgd.get("fully_diluted_valuation")) if cgd.get("fully_diluted_valuation") else None
else:
    db.add(CoinMetrics(
        coin_id=coin.id,
        date=today,
        market_cap=str(cgd.get("market_cap")) if cgd.get("market_cap") else None,
        fully_diluted_valuation=str(cgd.get("fully_diluted_valuation")) if cgd.get("fully_diluted_valuation") else None,
        source="coingecko",
    ))
```

### 8.2 Data Operation Required

**Operation:** Run the `/api/refresh` endpoint (or equivalent) for the affected coins.

**Scope:** All coins with `coingecko_id` configured and missing `market_cap` in `coin_metrics` for the `coingecko` source.

**Historical backfill:** NOT required. P3-06 eligibility uses `lte(coinMetrics.date, end)` and only requires existence of a valid record on or before the window-end date. One forward refresh is sufficient.

**Expected result:**
- Coin 11 receives a `coingecko` `market_cap` record for the current date.
- `loadRelativeStrengthInputs()` finds `capEligible.has(11) = true`.
- P3-06 calculates 7D RS for coin 11.
- Leadership receives 3 valid RS constituents.
- Leadership returns `VALID`.

### 8.3 Files NOT Modified

- No P3 calculation code (`relative-strength.ts`, `leadership.ts`, `preparation.ts`)
- No P3 contracts or specifications
- No thresholds, schemas, or persistence gates
- No test files (existing tests remain valid)

---

## 9. Required Owner Approval

**No owner approval is required for the recommended path (Option A).**

The recommended path restores the originally intended data flow. It does not change:
- Leadership minimum (remains 3)
- P3-06 market-cap requirement (remains mandatory)
- Canonical source definition (remains `coingecko`)
- Any P3 algorithm or threshold

**Owner approval WOULD be required for:**
- Option B: Accepting `binance_futures` as a fallback market-cap source.
- Option C: Removing the market-cap filter from P3-06.
- Option D: Reducing Leadership minimum from 3 to 2.

---

## 10. E.30 Retry Preconditions

P3-10E.30 (Controlled First Valid Production Execution) can be retried **after** the following:

1. **Code fix deployed:** `refresh.py` persists `market_cap` for `coingecko` source.
2. **Data refreshed:** The refresh pipeline has run and populated `coin_metrics.market_cap` for coin 11 (and other affected coins) with `source = 'coingecko'`.
3. **Verification:** Confirm via query that `coin_metrics` contains a non-null, positive `market_cap` for coin 11 with `source = 'coingecko'` and `date <= window_end`.

**Verification query:**
```sql
SELECT coin_id, source, market_cap, date
FROM coin_metrics
WHERE coin_id = 11
  AND source = 'coingecko'
  AND market_cap IS NOT NULL
  AND CAST(market_cap AS NUMERIC) > 0
ORDER BY date DESC
LIMIT 1;
```

Expected result: 1 row with `market_cap` ≈ $150M (matching the coingecko API value).

**Do NOT retry E.30 before this precondition is met.** Retrying with the current data will reproduce the same `INSUFFICIENT_HISTORY` result.

---

## 11. Production Safety Verification

### 11.1 This Task

| Check | Status |
|-------|--------|
| Production writes | 0 |
| Production mutations | 0 |
| P3 orchestrator execution | 0 |
| New snapshots created | 0 |
| Snapshot 7 modified | 0 |
| Intelligence #1 modified | 0 |
| Correction ledger modified | 0 |
| P0-P2 data modified | 0 |
| Threshold changes | 0 |
| Schema changes | 0 |

**Files created in this task:**
- `backend/audit_p3_10e_34.py` (read-only audit script)
- `docs/P3_Upgrade/P3_10E_34_LEADERSHIP_COIN11_RESOLUTION.md` (this document)

**No production data was touched. No P3 code was modified.**

### 11.2 Recommended Remediation (Future Task)

When the recommended remediation is executed in a follow-up task:

| Check | Expected Status |
|-------|-----------------|
| Production writes | Only `coin_metrics` INSERTs for `coingecko` source |
| Production mutations | `market_cap` field added to existing/new coingecko rows |
| P3 orchestrator execution | Only during E.30 retry verification |
| Schema changes | None (schema already supports `market_cap`) |
| Threshold changes | None |
| P3 contract changes | None |

---

## Appendix A — Audit Script

The forensic audit was performed by `backend/audit_p3_10e_34.py`. Key queries:

1. All `market_cap` records for coin 11 by source and date
2. Market-cap coverage for all AI constituents
3. Binance_futures vs coingecko value comparison
4. Coin metadata and schema inspection
5. P3 code source references for `P3_MARKET_CAP_SOURCE`

## Appendix B — Key Code References

| File | Line | Purpose |
|------|------|---------|
| `src/lib/p3/relative-strength.ts` | 15 | `P3_MARKET_CAP_SOURCE = "coingecko"` |
| `src/lib/p3/relative-strength.ts` | 16 | `MIN_VALID_RS_CONSTITUENTS = 3` |
| `src/lib/p3/relative-strength.ts` | 167-168 | P3-06 market-cap eligibility filter |
| `src/lib/p3/relative-strength.ts` | 96 | RS exclusion for `missing_market_cap` |
| `src/lib/p3/leadership.ts` | 100 | Leadership `< 3` → `INSUFFICIENT_HISTORY` |
| `src/lib/p3/leadership.ts` | 86 | Leadership exclusion for `missing_market_cap` |
| `src/lib/p3/leadership.ts` | 147 | Leadership market-cap eligibility filter |
| `src/lib/p3/preparation.ts` | 220-245 | Preparation layer market-cap loading |
| `src/lib/p3/preparation.ts` | 265-272 | Preparation exclusion for `missing_market_cap` |
| `src/lib/p3/preparation.ts` | 544 | Leadership `marketCapAvailable` flag |
| `backend/api/refresh.py` | 250-274 | Refresh pipeline: "only FDV, not Market Cap" |
| `backend/collectors/coingecko.py` | 35 | Collector fetches `market_cap` from API |
| `docs/P3_Upgrade/P3_10B_ARCHITECTURE_EXECUTION_CONTRACT.md` | 394, 420, 588 | P3-06/07 market-cap and minimum requirements |
