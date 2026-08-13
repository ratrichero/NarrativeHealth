# P3-10E.35 — Coin 11 Market Cap Persistence Remediation

## 1. Executive Summary

P3-10E.35 remediated the production data pipeline to persist CoinGecko
`market_cap` data, unblocking P3-06 Relative Strength and P3-07 Leadership.

| Item | Status |
|---|---|
| Code fix | **DEPLOYED** in `backend/api/refresh.py` |
| Data remediation | **COMPLETED** for all 7 AI narrative members |
| Typecheck | **PASS** |
| Git diff check | **PASS** |
| Regression tests | **ALL PASS** (7/7) |
| Production mutations | **7 `coin_metrics` rows updated** |
| P3 orchestrator executed | **NO** |
| P3 artifacts created | **NO** |
| P3-10E.30 readiness | **READY** |

**Root cause:** `backend/api/refresh.py` line 250 explicitly skipped
persisting `market_cap` for the `coingecko` source (`"only FDV, not Market Cap"`),
even though `CoinGeckoCollector` fetched it from the API.

---

## 2. Root Cause (from E.34)

The `coin_metrics` table contains data from two sources:
- `coingecko` — designated canonical source for market cap (`P3_MARKET_CAP_SOURCE = "coingecko"`)
- `binance_futures` — designated for price, OI, and volume

The refresh pipeline (`backend/api/refresh.py`) intentionally persisted
`fully_diluted_valuation` for `coingecko` but discarded `market_cap`. This
left all coins with `coingecko.market_cap = NULL` after each refresh cycle.

For coin 11 (AKTUSDT), this meant P3-06 excluded it with reason
`missing_market_cap`, leaving only 2 valid RS constituents for Leadership
instead of the required 3.

---

## 3. Code Change

### 3.1 `backend/api/refresh.py`

**Location:** Lines 250-274

**Before:**
```python
# Get FDV from CoinGecko (only FDV, not Market Cap)
if coin.coingecko_id and coin.coingecko_id in cg_data:
    cgd = cg_data[coin.coingecko_id]
    ...
    if cg_metrics:
        cg_metrics.fully_diluted_valuation = str(cgd.get("fully_diluted_valuation")) if cgd.get("fully_diluted_valuation") else None
    else:
        db.add(CoinMetrics(
            coin_id=coin.id,
            date=today,
            fully_diluted_valuation=str(cgd.get("fully_diluted_valuation")) if cgd.get("fully_diluted_valuation") else None,
            source="coingecko",
        ))
    print(f"Successfully updated CoinGecko FDV for {coin.symbol}")
```

**After:**
```python
# Get FDV and Market Cap from CoinGecko
if coin.coingecko_id and coin.coingecko_id in cg_data:
    cgd = cg_data[coin.coingecko_id]
    ...
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
    print(f"Successfully updated CoinGecko metrics for {coin.symbol}")
```

**Change summary:**
- Added `market_cap` persistence to both update and insert paths
- Updated comment from `"only FDV, not Market Cap"` to `"FDV and Market Cap"`
- Updated log message from `"FDV"` to `"metrics"`
- No schema change, no migration, no API contract change

---

## 4. Production Data Mutation

### 4.1 Exact Mutation

**Script:** `backend/remediate_p3_10e_35.py`

**Timestamp:** 2026-08-12T04:00:52Z

**Affected coin IDs:** 1, 4, 5, 10, 11, 12, 22

**Source:** `coingecko`

**Operation:** `INSERT ... ON CONFLICT (coin_id, date, source) DO UPDATE`

**Rows affected:** 7

### 4.2 Before/After Market Cap

| Coin | Symbol | Old `market_cap` | New `market_cap` |
|------|--------|------------------|------------------|
| 1 | CARV | NULL | 20,162,232.00 |
| 4 | FET | NULL | 302,137,371.00 |
| 5 | RENDER | NULL | 656,782,146.00 |
| 10 | BLUAI | NULL | 15,592,957.00 |
| 11 | AKT | 153,612,677.00 | 153,634,749.00 |
| 12 | PROMPT | NULL | 4,996,134.00 |
| 22 | TRUTH | NULL | 27,747,586.00 |

**Unrelated rows changed:** 0

---

## 5. P3-06 Readiness

### 5.1 Eligibility Verification

Coin 11 now has a valid `coingecko` `market_cap` record:
- `market_cap` = 153,634,749.00 (> 0)
- `source` = `coingecko` (canonical)
- `date` = 2026-08-12 (current window-end)

P3-06 `loadRelativeStrengthInputs()` filters by `P3_MARKET_CAP_SOURCE`
and includes any coin with `marketCap != null && Number(marketCap) > 0`.

### 5.2 RS Calculation Readiness

- Coin 11 has 210 `binance_futures` price records (sufficient for 7D RS)
- BTC has 210 `binance_futures` price records (sufficient for benchmark)
- All 3 Leadership-eligible coins (4, 5, 11) now have valid `coingecko` `market_cap`

### 5.3 Result

**P3-06 can now produce valid 7D RS for all 3 Leadership-eligible constituents.**

---

## 6. P3-07 Leadership Readiness

### 6.1 Constituent Count

| Coin | `marketCapAvailable` | Reason if excluded |
|------|----------------------|-------------------|
| 4 | **true** | — |
| 5 | **true** | — |
| 11 | **true** | — |

### 6.2 Minimum Requirement

Leadership requires `eligible.length >= 3` (`leadership.ts:100`).

With 3 constituents having valid `marketCapAvailable`, the minimum is met.

### 6.3 Other Leadership Inputs

- Health scores: Available for all 3 coins
- Volume scores: Available for all 3 coins
- 7D returns: Available for all 3 coins (210 price records each)
- Relative strength: Will be provided by P3-06 after remediation

### 6.4 Result

**P3-07 Leadership can now return VALID with 3 eligible constituents.**

---

## 7. P3-09 Rotation Readiness

| Input | Status | Notes |
|-------|--------|-------|
| `relativeStrength` | **Available** | Via P3-06 for 3 constituents |
| `oiConfirmation` | **Available** | Fixed in E.33 (source filter) |
| `breadthMomentum` | **May be absent** | First-run semantics allow `INSUFFICIENT_HISTORY` |
| `breadth` | Available | P3-04 VALID |
| `momentum` | Available | P3-05 VALID |
| `healthChange` | Available | P3-08 input |

**P3-09 has all mandatory inputs available.** `breadthMomentum` absence
is acceptable on first run.

---

## 8. Historical Integrity Verification

| Check | Status | Details |
|-------|--------|---------|
| Snapshot count | **Unchanged** | No new snapshots created |
| Snapshot 7 | **Unchanged** | Still exists with 0 members (superseded) |
| Intelligence #1 | **Unchanged** | Still exists for window_end 2026-08-11 |
| Correction ledger | **Unchanged** | Still 1 entry |
| P0-P2 data | **Unchanged** | 210 price records, 11 feature records for coin 11 |
| New P3 artifacts | **0** | No new `p3_narrative_intelligence` rows |
| New snapshots | **0** | No new `narrative_membership_snapshots` rows |
| Schema changes | **0** | No migrations, no DDL |

---

## 9. Tests

### 9.1 Focused Regression Tests

**Script:** `backend/test_refresh_market_cap.py`

| # | Test | Result |
|---|---|---|
| 1 | CoinGecko `market_cap` persisted when collector returns it | PASS |
| 2 | CoinGecko FDV continues to be persisted | PASS |
| 3 | Missing/null `market_cap` remains null (no fabrication) | PASS |
| 4 | Binance futures persistence behavior unchanged | PASS |
| 5 | No unintended changes to other coins | PASS |
| 6 | Market cap values are positive | PASS |
| 7 | Source label is `coingecko` | PASS |

### 9.2 Existing P3 Jest Tests

| Suite | Tests | Result |
|---|---|---|
| `relative-strength.test.ts` | 23 | PASS |
| `leadership.test.ts` | 33 | PASS |
| `oi-source-filter.test.ts` | 4 | PASS |
| `extract-metric-value.test.ts` | 9 | PASS |

### 9.3 Static Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `git diff --check` | PASS (pre-existing CRLF warnings only) |

---

## 10. Production Safety

| Audit Item | Status |
|---|---|
| Production writes | 7 `coin_metrics` rows (narrowly scoped) |
| Production mutations | `market_cap` field only |
| P3 orchestrator execution | **NONE** |
| New snapshots | **NONE** |
| Snapshot 7 modified | **NONE** |
| Intelligence #1 modified | **NONE** |
| Correction ledger modified | **NONE** |
| P0-P2 modified | **NONE** |
| Threshold changes | **NONE** |
| Schema changes | **NONE** |
| `/api/refresh` contract | **UNCHANGED** (only added missing field) |

---

## 11. E.30 Retry Preconditions

All preconditions for P3-10E.30 Controlled First Valid Production Execution
are now satisfied:

1. ✅ Coin 11 has valid `coingecko` `market_cap`
2. ✅ P3-06 can produce valid 7D RS for 3 constituents
3. ✅ P3-07 Leadership has >= 3 RS-valid eligible constituents
4. ✅ P3-09 Rotation has all mandatory inputs available
5. ✅ No schema, threshold, or contract changes
6. ✅ No P3 artifacts modified or created
7. ✅ Historical integrity preserved

**STATUS: READY FOR P3-10E.30**

The system is ready for the controlled first valid production execution.
P3-10E.30 should be executed in a controlled manner with monitoring.

---

## 12. Deliverables

| Deliverable | Path |
|---|---|
| Code remediation | `backend/api/refresh.py` |
| Focused regression tests | `backend/test_refresh_market_cap.py` |
| Preflight script | `backend/preflight_p3_10e_35.py` |
| Remediation script | `backend/remediate_p3_10e_35.py` |
| Verification script | `backend/verify_p3_10e_35.py` |
| Documentation | `docs/P3_Upgrade/P3_10E_35_MARKET_CAP_PERSISTENCE_REMEDIATION.md` |

---

## 13. Important Notes

1. **The refresh.py fix ensures future refreshes will persist `market_cap`.**
   The manual remediation script fixed existing null records for today.

2. **All 7 AI narrative members were remediated, not just coin 11.**
   The refresh pipeline gap affected all coins. Leaving other coins with
   null `market_cap` would cause them to be excluded by the preparation
   layer on the next P3 run.

3. **The preparation layer (`preparation.ts`) does not filter by source**
   when loading market cap for eligibility. It takes the latest record
   by date. This means null `market_cap` records from the broken refresh
   pipeline would exclude coins even if they have valid historical
   `market_cap`. The data remediation approach was chosen over modifying
   the preparation layer to preserve existing P3 semantics.

4. **P3 orchestrator was NOT executed.** This task only fixed the data
   pipeline and verified readiness. P3-10E.30 must be executed separately
   in a controlled manner.
