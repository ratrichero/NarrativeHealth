# P6-01D-A — Data Quality Landscape Recon

**Date:** 2026-08-22
**Task Type:** RECON ONLY — NO IMPLEMENTATION
**Evidence:** Code-based, source-verified, test-verified
**Frozen Authorities:** P6-01B, P6-01C, P6-01C-E, P6-01D execution plan

---

## 1. Executive Summary

NarrativeHealth's current data quality behavior is **almost entirely absent at the observation level**. The system relies on upstream API reliability and implicit type coercion rather than explicit validation. Key findings:

1. **No observation-level quality status exists** — there is no `quality_status` field on `market_price_daily` or `coin_metrics`.
2. **No numeric validation** — collectors pass raw API responses through `parseFloat()` without checking for NaN, Infinity, negative values, or range sanity.
3. **No OHLC relationship validation** — HIGH < LOW, OPEN outside HIGH/LOW, CLOSE outside HIGH/LOW are never checked.
4. **Null handling is implicit** — nullable DB columns silently accept nulls without classification.
5. **Deduplication exists** via `onConflictDoUpdate` but operates at the DB constraint level, not at the semantic identity level.
6. **Timestamp handling is partial** — kline `openTime` is converted to a business date but `observed_at` is not stored.
7. **Source failure is tracked** via `source_status` table (OK/PARTIAL/FAILED) but this is operational status, not data quality.
8. **Feature engine has a single data sufficiency guard** — `< 20 rows` returns neutral 50 scores with an error flag, but this is feature-level, not observation-level.
9. **No tests exist** for invalid/missing/malformed observation data — the only P6 tests are for the registry and freshness evaluator.
10. **The `features` table carries `dataCompleteness` and `missingSources`** — these are the closest existing quality semantics, but they measure source availability, not observation validity.

**Classification of quality behavior:**

| Category | Status |
|---|---|
| Explicitly implemented in code | Source status tracking (OK/PARTIAL/FAILED), data completeness, missing sources, insufficient data guard |
| Enforced by database constraints | Unique constraints (dedup), NOT NULL on required fields, foreign keys |
| Enforced only by tests | None for quality — P6 registry/freshness tests only |
| Documented but not implemented | P6-01B quality model (VALID/INVALID/MISSING/UNKNOWN) — contract only |
| Currently absent | Observation-level quality status, numeric validation, OHLC validation, timestamp validation, entity validation |

---

## 2. Scope and Authority

**P6-01D-A is recon only.** This report documents current implementation truth. It does NOT:

- Define VALID/INVALID/MISSING/UNKNOWN rules
- Design the P6 Data Quality contract
- Modify production code, schema, collectors, APIs, or tests
- Reintroduce AGING/INSUFFICIENT/DEGRADED as freshness states
- Conflate quality with freshness

**P6-01D Frozen Boundary:**
- Data Quality vocabulary: VALID / INVALID / MISSING / UNKNOWN
- Freshness vocabulary: FRESH / STALE / UNKNOWN (frozen under P6-01C)
- These are independent dimensions

---

## 3. Current Observation Validation Architecture

The current pipeline has **no explicit observation validation architecture**. The data flow is:

```
External API
  ↓ [try/catch only — returns empty array or null on failure]
Collector (binance.ts / coingecko.ts)
  ↓ [parseFloat() — no NaN/range validation]
  ↓ [string concatenation for OHLCV — no type coercion check]
Refresh Route (refresh/route.ts)
  ↓ [onConflictDoUpdate — dedup via DB unique constraint]
  ↓ [No validation before insert]
PostgreSQL (market_price_daily / coin_metrics)
  ↓ [NOT NULL on required fields, nullable on optional fields]
  ↓ [No CHECK constraints on numeric ranges]
Feature Engine (features/engine.ts)
  ↓ [One guard: priceData.length < 20]
  ↓ [No input validation on numeric values]
Features / Health Scores / Recommendations
```

**Critical gap:** Between the Collector and the Database, there is zero validation. Malformed, negative, zero, NaN, or impossible values will be persisted if they pass the PostgreSQL type check (decimal precision).

---

## 4. Source-by-Source Findings

### 4.1 Binance Spot (`src/lib/collectors/binance.ts`)

**fetchBinanceSpotKlines:**
- **Absent data:** Returns `[]` (empty array) via catch → logged to console.error
- **Null field:** Not checked — raw API array elements are cast via `as string`/`as number`
- **Malformed payload:** Not caught — if API returns unexpected structure, `k[0] as number` will produce `undefined` or `NaN`
- **Negative values:** Not checked
- **Zero values:** Not checked
- **Timestamp:** `openTime` from kline array (index 0) is passed as `number` — not validated as a valid timestamp
- **Entity mapping:** Symbol passed directly to API — Binance returns 400/412 on invalid symbol, caught by try/catch, returns `[]`
- **Numeric conversion:** Raw API values are strings; passed as `kline.open`, `kline.close` etc. (strings) directly into DB — PostgreSQL `decimal` column handles parsing
- **Retry:** None
- **Fallback:** None at collector level; refresh route falls back to Spot when Futures fails

**fetchBinanceSpotTicker:**
- Returns raw `response.data` (any) or null on error
- No field validation
- Used for `quoteVolume` and `lastPrice` — `parseFloat()` with no NaN check

### 4.2 Binance Futures (`src/lib/collectors/binance.ts`)

**fetchBinanceFuturesKlines:**
- Identical structure to Spot klines collector
- Same validation gaps

**fetchBinanceFuturesOI:**
- Returns `parseFloat(response.data.openInterest)` or `null` on error
- **No NaN check** — if `response.data.openInterest` is undefined, parseFloat returns NaN
- **No negative check** — OI should always be ≥ 0
- **No zero check** — zero OI is possible but unusual
- **No timestamp provided** — API returns only `openInterest` field

**fetchBinanceFundingRate:**
- Returns `parseFloat(response.data.lastFundingRate)` or `null` on error
- **No NaN check**
- **Range not validated** — funding rate can be negative (normal) but extreme values (e.g., > 1.0 or < -1.0) are not checked
- **Timestamp available but discarded** — API response includes `time` field but collector does not capture it
- This is the only SOURCE_SNAPSHOT metric where the API provides a timestamp that could serve as `observed_at`

**fetchBinanceFuturesMetrics:**
- Wraps OI + Funding in `Promise.all` — if one succeeds and other fails, partial result returned

**fetchBinanceOIHistory:**
- Returns `{ timestamp: number; openInterest: number }[]`
- Uses `parseFloat(item.sumOpenInterest)` — no NaN check
- Timestamp from API is preserved
- Not persisted — used only for `oiPrev` comparison in refresh route

### 4.3 CoinGecko (`src/lib/collectors/coingecko.ts`)

**fetchCoinGeckoMarkets:**
- Batch fetch for multiple coins
- Returns `Map<string, CoinGeckoMetrics>`
- **Null handling:** CoinGecko may return `null` for `fully_diluted_valuation` — handled via optional chaining: `coin.fully_diluted_valuation`
- **NaN not checked** — `coin.market_cap` could theoretically be undefined → stored as-is
- **Zero values:** Not checked — zero market cap would be unusual but accepted
- **Negative values:** Not checked
- **No timestamp** — CoinGecko markets endpoint returns snapshot data with no explicit observation timestamp
- **Graceful degradation:** Returns empty Map on API failure (not null)
- **No retry**

---

## 5. Metric-by-Metric Validation Findings

### 5.1 OPEN

| Aspect | Evidence |
|---|---|
| Source | Binance kline `open` field (string) |
| Storage | `market_price_daily.open` — `decimal(24,8)` NOT NULL |
| Validation in code | None |
| DB constraint | NOT NULL, decimal precision only |
| NaN possible? | Yes — if API returns unexpected format, `k[1] as string` bypasses type check; PostgreSQL decimal will reject non-numeric strings at insert time |
| Negative possible? | Yes — no range check; PostgreSQL allows negative decimals |
| Zero possible? | Yes — no range check |
| Quality status | NOT IMPLEMENTED |

### 5.2 HIGH

| Aspect | Evidence |
|---|---|
| Source | Binance kline `high` field (string) |
| Storage | `market_price_daily.high` — `decimal(24,8)` NOT NULL |
| Validation in code | None |
| DB constraint | NOT NULL, decimal precision only |
| HIGH < LOW check? | **NOT IMPLEMENTED** |
| OPEN outside HIGH/LOW check? | **NOT IMPLEMENTED** |

### 5.3 LOW

| Aspect | Evidence |
|---|---|
| Source | Binance kline `low` field (string) |
| Storage | `market_price_daily.low` — `decimal(24,8)` NOT NULL |
| Validation in code | None |
| DB constraint | NOT NULL, decimal precision only |

### 5.4 CLOSE

| Aspect | Evidence |
|---|---|
| Source | Binance kline `close` field (string) |
| Storage | `market_price_daily.close` — `decimal(24,8)` NOT NULL |
| Validation in code | None |
| DB constraint | NOT NULL, decimal precision only |
| CLOSE outside HIGH/LOW check? | **NOT IMPLEMENTED** |
| Note | P6-01B defines PRICE as alias for CLOSE, not a separate metric |

### 5.5 VOLUME

| Aspect | Evidence |
|---|---|
| Source | Binance kline `volume` field (string) |
| Storage | `market_price_daily.volume` — `decimal(24,2)` NOT NULL |
| Validation in code | None |
| Zero possible? | Yes — zero volume is possible for delisted/paused pairs |
| Negative possible? | No — Binance never returns negative volume, but code does not enforce this |
| Null possible? | NOT NULL in schema — insert would fail if null |

### 5.6 QUOTE_VOLUME

| Aspect | Evidence |
|---|---|
| Source | Binance kline `quoteVolume` field (string) |
| Storage | `market_price_daily.quoteVolume` — `decimal(24,2)` **nullable** |
| Validation in code | None |
| Null possible? | Yes — column is nullable; if API doesn't provide it, null is stored |

### 5.7 MARKET_CAP

| Aspect | Evidence |
|---|---|
| Source | CoinGecko `market_cap` field OR calculated from Binance (volume × price) |
| Storage | `coin_metrics.marketCap` — `decimal(24,2)` **nullable** |
| Validation in code | `marketCapToSave !== null && marketCapToSave > 0` check in refresh route before insert |
| Null possible? | Yes — CoinGecko may not have data; column is nullable |
| Zero possible? | Filtered out by `> 0` check in refresh route |
| Negative possible? | Not checked — CoinGecko should never return negative, but no code guard |
| Timestamp | **NOT STORED** — no `observed_at` field in `coin_metrics` |
| **Source fallback** | CoinGecko preferred → Binance approximate (volume × lastPrice) fallback |

### 5.8 FDV

| Aspect | Evidence |
|---|---|
| Source | CoinGecko `fully_diluted_valuation` field |
| Storage | `coin_metrics.fullyDilutedValuation` — `decimal(24,2)` **nullable** |
| Validation in code | None beyond CoinGecko's `?.` optional chaining |
| Null possible? | Yes — CoinGecko may return null for FDV |
| Zero possible? | Yes — accepted without check |
| Negative possible? | Not checked |

### 5.9 OPEN_INTEREST

| Aspect | Evidence |
|---|---|
| Source | Binance Futures `GET /fapi/v1/openInterest` → `response.data.openInterest` |
| Storage | `coin_metrics.openInterest` — `decimal(24,2)` **nullable** |
| Validation in code | `parseFloat()` only — no NaN check |
| Null possible? | Yes — null returned on API error |
| Zero possible? | Yes — zero OI possible for new/delisted contracts |
| Negative possible? | Not checked — should never be negative, but no guard |
| Timestamp | **NOT PROVIDED BY API** — `observed_at = UNKNOWN` per P6-01C-E1 |

### 5.10 FUNDING_RATE

| Aspect | Evidence |
|---|---|
| Source | Binance Futures `GET /fapi/v1/premiumIndex` → `response.data.lastFundingRate` |
| Storage | `coin_metrics.fundingRate` — `decimal(18,8)` **nullable** |
| Validation in code | `parseFloat()` only — no NaN check |
| Null possible? | Yes — null returned on API error |
| Negative possible? | **YES — NEGATIVE IS NORMAL** (shorts paying longs) |
| Range check? | **NOT IMPLEMENTED** — extreme values (e.g., ±0.5) are accepted |
| Timestamp | API has `time` field but **DISCARDED** by collector — `observed_at = UNKNOWN` per P6-01C-E1 |

---

## 6. Null / Missing Behavior

### 6.1 Database-Level Null Behavior

| Table | Column | Nullable | Behavior |
|---|---|---|---|
| `market_price_daily` | `open`, `high`, `low`, `close`, `volume` | **NOT NULL** | Insert fails if null |
| `market_price_daily` | `quoteVolume`, `volume24h` | nullable | Null stored silently |
| `coin_metrics` | `openInterest`, `fundingRate`, `marketCap`, `fullyDilutedValuation`, `circulatingSupply`, `totalSupply` | **all nullable** | Null stored silently |
| `coin_metrics` | `source` | NOT NULL | Required |
| `features` | `trendScore`, `derivativeScore`, etc. | nullable | Null possible if feature engine returns null |

### 6.2 Collector Null Propagation

| Collector | Return on failure | Return on partial data |
|---|---|---|
| `fetchBinanceSpotKlines` | `[]` (empty array) | N/A — all-or-nothing |
| `fetchBinanceFuturesKlines` | `[]` (empty array) | N/A |
| `fetchBinanceFuturesOI` | `null` | N/A |
| `fetchBinanceFundingRate` | `null` | N/A |
| `fetchBinanceFuturesMetrics` | `{ openInterest: null, fundingRate: null }` on total failure | Partial: one null, one valid |
| `fetchCoinGeckoMarkets` | `Map()` (empty) | N/A — batch |

### 6.3 Refresh Route Null Handling

- If `klines.length === 0` → no price data inserted (skip)
- If `oiCurrent === null && fundingRate === null` → no coin_metrics row for futures
- If `oiCurrent !== null || fundingRate !== null` → row inserted with nulls for missing fields
- If `coingeckoData` is empty → no CoinGecko metrics inserted
- **Critical:** There is no classification of WHY data is null (source failure vs. legitimately null value)

### 6.4 Feature Engine Null Handling

- If `priceData.length < 20` → returns neutral 50 scores with `error: "Insufficient price data"`
- `dataCompleteness` and `missingSources` track which sources failed — this is the closest quality signal
- If OI/FR are null → derivative score returns 50 (neutral) with `no_futures: true`

---

## 7. Malformed Payload Behavior

### 7.1 Binance Kline Response

Binance klines return arrays: `[openTime, open, high, low, close, volume, closeTime, quoteVolume, ...]`

The collector maps:
```typescript
open: k[1] as string,
high: k[2] as string,
```

**If the API returns unexpected types:**
- TypeScript `as string` is a compile-time only cast — no runtime validation
- If `k[1]` is `undefined` or a number instead of string → stored as `undefined` in the KlineData object
- PostgreSQL `decimal` column will reject non-numeric strings at insert time → **insert fails with DB error**
- The error is caught by the `try/catch` in the refresh route's per-coin processing → logged and coin skipped

**Verdict:** Malformed Binance payloads cause the entire coin processing to fail (not individual fields).

### 7.2 CoinGecko Markets Response

CoinGecko returns typed JSON with known structure. The collector uses:
```typescript
marketCap: coin.market_cap,
fullyDilutedValuation: coin.fully_diluted_valuation,
```

**If the API returns unexpected types:**
- CoinGecko typically returns consistent types (numbers or null)
- No runtime validation exists
- If a field is unexpectedly a string → PostgreSQL decimal would fail at insert

**Verdict:** Malformed CoinGecko payloads would fail at the DB insert level, not caught earlier.

### 7.3 No Explicit Payload Validation

There is **no schema validation** (e.g., Zod, Joi, TypeScript runtime check) on any collector response. The system trusts:
1. Binance API to return well-formed kline arrays
2. CoinGecko API to return well-structured JSON
3. TypeScript type assertions (`as string`, `as number`) — which are compile-time only

---

## 8. Numeric Validation Behavior

### 8.1 parseFloat Usage

| Location | Expression | NaN Risk |
|---|---|---|
| `fetchBinanceFuturesOI` | `parseFloat(response.data.openInterest)` | **YES** — undefined → NaN |
| `fetchBinanceFundingRate` | `parseFloat(response.data.lastFundingRate)` | **YES** — undefined → NaN |
| `refresh/route.ts` | `parseFloat(futuresTicker.quoteVolume)` | **YES** — if ticker null |
| `refresh/route.ts` | `parseFloat(futuresTicker.lastPrice)` | **YES** — if ticker null |
| `refresh/route.ts` | `parseFloat(spotTicker.quoteVolume)` | **YES** — if ticker null |
| `refresh/route.ts` | `priceDataFormatted: parseFloat(p.close)` | **NO** — values come from DB decimal, which parsed successfully |
| `refresh/route.ts` | `marketCapToSave = volume24h * parseFloat(futuresTicker.lastPrice)` | **YES** — if lastPrice is NaN, result is NaN |

### 8.2 NaN Propagation

If `parseFloat()` returns NaN:
1. NaN is stored as a decimal value in PostgreSQL — **PostgreSQL `decimal` column will REJECT NaN at insert time**
2. The insert will throw an exception
3. The exception is caught by the per-coin try/catch in refresh route
4. The entire coin processing for that refresh cycle is skipped
5. Source status is updated to FAILED

**Verdict:** NaN values cause coin-level failure, not field-level failure. The system does not gracefully degrade — it either persists all metrics for a coin or none.

### 8.3 Infinity

- `Infinity` can be produced by `parseFloat("Infinity")` or division by zero in some paths
- PostgreSQL `decimal` column **rejects Infinity** — same behavior as NaN
- No explicit Infinity check exists in code

### 8.4 Negative Values

| Metric | Can Be Negative (Legitimately) | Checked? |
|---|---|---|
| OPEN | No | No |
| HIGH | No | No |
| LOW | No | No |
| CLOSE | No | No |
| VOLUME | No | No |
| QUOTE_VOLUME | No | No |
| MARKET_CAP | No | No |
| FDV | No | No |
| OPEN_INTEREST | No | No |
| FUNDING_RATE | **Yes** (negative = shorts pay longs) | No |

### 8.5 Zero Values

| Metric | Zero Possible? | Handled? |
|---|---|---|
| OPEN | No (in normal trading) | No |
| HIGH | No | No |
| LOW | No | No |
| CLOSE | No | No |
| VOLUME | Yes (delisted pairs) | No |
| QUOTE_VOLUME | Yes | No |
| MARKET_CAP | Filtered by `> 0` check in refresh route | **Partial** — only for CoinGecko path |
| FDV | Yes | No |
| OPEN_INTEREST | Yes | No |
| FUNDING_RATE | Yes (neutral funding) | No |

---

## 9. OHLC Relationship Behavior

### 9.1 Current State

**No OHLC relationship validation exists anywhere in the codebase.**

The following impossible states are never checked:
- `HIGH < LOW` (highest price is below lowest price)
- `OPEN > HIGH` (opening price is above the period's high)
- `OPEN < LOW` (opening price is below the period's low)
- `CLOSE > HIGH` (closing price is above the period's high)
- `CLOSE < LOW` (closing price is below the period's low)

### 9.2 Risk Assessment

Binance API should always return consistent OHLCV data. However:
- Edge cases during exchange maintenance or API glitches could produce inconsistent data
- Cross-source comparison (Spot vs Futures for same coin) could reveal inconsistencies
- The system has **no mechanism to detect or handle** such inconsistencies

### 9.3 Evidence Location

- `refresh/route.ts` lines ~330-370: Klines are persisted directly with `kline.open`, `kline.high`, etc.
- No validation block exists before the `db.insert(marketPriceDaily)` call
- The feature engine consumes OHLCV data without validation: `src/lib/features/calculator.ts` — `preparePriceSeries()` trusts input

---

## 10. Timestamp Validation Behavior

### 10.1 Kline Timestamps

- Binance kline `openTime` (index 0) is a Unix timestamp in milliseconds
- Converted to business date via `getBusinessDate(new Date(kline.openTime))` in Asia/Ho_Chi_Minh timezone
- **No validation:**
  - Future timestamps accepted
  - Very old timestamps accepted
  - Zero or negative timestamps would produce invalid Date objects (but would fail at `new Date()` level)
- **`observed_at` is NOT stored** — only `date` (business_date) is persisted in `market_price_daily`
- `collected_at` is set to `createdAt: defaultNow()` (DB write time)

### 10.2 SOURCE_SNAPSHOT Timestamps

- OI: **No timestamp from API** → `observed_at = UNKNOWN` per P6-01C-E1
- Funding Rate: API has `time` field but **discarded** by collector → `observed_at = UNKNOWN`
- CoinGecko: No explicit observation timestamp → `observed_at = UNKNOWN`

### 10.3 Business Date

- `getBusinessDate()` in `src/lib/utils.ts` uses `Asia/Ho_Chi_Minh` timezone
- Converts UTC timestamps to Vietnam time for business day bucketing
- Only applied to kline data (price observations)
- Not applied to SOURCE_SNAPSHOT data (OI, FR, MC, FDV)

---

## 11. Entity / Symbol Validation

### 11.1 Entity Mapping

| Source | Entity Key | Validation |
|---|---|---|
| Binance Spot | `coins.binanceSpotSymbol` (e.g., "BTCUSDT") | **None** — symbol passed directly to API; invalid symbol returns empty array |
| Binance Futures | `coins.binanceFuturesSymbol` (e.g., "BTCUSDT") | **None** — same as Spot |
| CoinGecko | `coins.coingeckoId` (e.g., "bitcoin") | **None** — invalid ID returns empty Map |

### 11.2 Unknown Symbol Behavior

- If a coin has no `binanceSpotSymbol` → console.warn, no data collected, source_status = FAILED
- If a coin has no `binanceFuturesSymbol` → OI/FR collection skipped
- If a coin has no `coingeckoId` → CoinGecko collection skipped
- **No explicit "entity not found" quality status** — the system treats missing entity mapping as "source unavailable"

### 11.3 Source Symbol Mismatch

- No validation that a Binance Spot symbol corresponds to the same asset as a Binance Futures symbol
- No validation that a CoinGecko ID corresponds to the same asset
- The system trusts admin-configured `coins` table metadata

---

## 12. Duplicate Behavior

### 12.1 Deduplication Mechanism

Deduplication is handled at the **database constraint level** via Drizzle's `onConflictDoUpdate`:

| Table | Unique Constraint | Behavior |
|---|---|---|
| `market_price_daily` | `(coinId, date)` | **Upsert** — latest kline data overwrites previous for same coin+date |
| `coin_metrics` | `(coinId, date, source)` | **Upsert** — latest metrics overwrite for same coin+date+source |
| `features` | `(coinId, date, versionId)` | **Upsert** |
| `health_scores` | `(coinId, date)` | **Upsert** |
| `recommendations` | `(coinId, date)` | **Upsert** |

### 12.2 Semantic Identity

- For `market_price_daily`: identity = `(coinId, date)` — **NOT** `(coinId, date, source)`. This means Futures data can overwrite Spot data and vice versa for the same coin+date.
- For `coin_metrics`: identity = `(coinId, date, source)` — multiple sources can coexist for the same date
- **P6-01B observation identity** would be `(entity_id, metric, source, observed_at, timeframe)` — this is a more granular identity than current DB dedup

### 12.3 Repeated Collector Execution

- Running refresh multiple times per day: klines for the same date are upserted (overwritten)
- OI/FR for the same date are upserted (overwritten)
- No idempotency tracking at the application level
- **No deduplication at the observation semantic level** — the system relies on DB constraints

---

## 13. Partial Observation Behavior

### 13.1 Partial Source Payloads

| Scenario | Behavior |
|---|---|
| Binance klines succeed, OI/FR fail | Price data persisted; OI/FR null; coin_metrics row not inserted for futures source |
| Binance Spot fails, Futures succeeds | Futures data used; Spot source_status = FAILED |
| Both Binance sources fail | No price data; coin skipped for feature calculation |
| CoinGecko fails | No MC/FDV; Binance approximate used for MC; FDV null |
| Klines succeed but ticker fails | Price data persisted; volume24h = null |
| 4h klines fail, 1d klines succeed | 1d data used; 4h indicators not calculated |

### 13.2 Impact on Feature Calculation

- If `priceData.length < 20` → all features return 50 (neutral) with error
- If OI is null → derivative score returns 50 (neutral) with `no_futures: true`
- If FR is null → funding component defaults to 55 (neutral)
- **Partial data does not cause failure** — it degrades to neutral scores

---

## 14. API / Collector Failure Behavior

### 14.1 Failure Handling Pattern

All collectors follow the same pattern:

```typescript
try {
  const response = await axios.get(..., { timeout: 10000 });
  return processResponse(response.data);
} catch (error) {
  console.error(`... error for ${symbol}:`, error);
  return []; // or null
}
```

### 14.2 Failure Categories

| Failure Type | Handling | Quality Signal |
|---|---|---|
| HTTP 4xx (invalid symbol, rate limit) | Caught, returns empty/null | source_status = FAILED |
| HTTP 5xx (server error) | Caught, returns empty/null | source_status = FAILED |
| Timeout (10s) | Caught, returns empty/null | source_status = FAILED |
| Network error | Caught, returns empty/null | source_status = FAILED |
| Empty response (no data) | `response.data.length === 0` → empty array | source_status = FAILED |
| Malformed response | Not caught — may produce undefined values → DB insert fails | source_status = FAILED (indirect) |

### 14.3 Retry Semantics

**No retry mechanism exists.** If a collector fails:
1. Returns empty/null
2. Refresh route catches and logs
3. Source_status = FAILED
4. Data is missing for that refresh cycle
5. Next refresh cycle (4h later) will attempt again

### 14.4 Idempotency

- Refresh route uses `onConflictDoUpdate` — re-running is safe
- No explicit idempotency token or request deduplication
- The refresh lock (`checkRefreshLock`) prevents concurrent refreshes but not sequential duplicates

---

## 15. Database Constraints

### 15.1 NOT NULL Constraints

| Table | NOT NULL Columns | Quality Implication |
|---|---|---|
| `market_price_daily` | `coinId`, `date`, `open`, `high`, `low`, `close`, `volume`, `source` | OHLCV required — insert fails if any null |
| `coin_metrics` | `coinId`, `date`, `source` | Only identity required; all metrics nullable |
| `features` | `coinId`, `date`, `versionId` | Only identity required; all scores nullable |
| `health_scores` | `coinId`, `date`, `healthScore`, `status` | Score + status required |
| `source_status` | `source`, `coinId`, `status`, `lastAttempt` | Operational status required |

### 15.2 CHECK Constraints

**No CHECK constraints exist on numeric value ranges.** The only CHECK constraints in the codebase are on `narrative_membership_events`:
- `eventType IN ('ADDED', 'REMOVED', 'PRIMARY_SET')`
- `isPrimary IS NOT NULL` for non-REMOVED events
- `snapshotRevision > 0`
- `memberCount >= 0`
- `membershipState = 'MEMBER'`

These are all in the P3 membership tables, not in market data tables.

### 15.3 UNIQUE Constraints (Dedup)

| Table | Unique On | Implication |
|---|---|---|
| `market_price_daily` | `(coinId, date)` | One OHLCV record per coin per day |
| `coin_metrics` | `(coinId, date, source)` | Multiple sources per coin per day |
| `features` | `(coinId, date, versionId)` | One feature set per coin per version per day |
| `health_scores` | `(coinId, date)` | One health score per coin per day |
| `indicators` | `(coinId, date, timeframe, indicatorType)` | One indicator per type per timeframe per day |

### 15.4 Foreign Keys

All market data tables reference `coins.id` with `ON DELETE CASCADE` — deleting a coin removes all its data.

---

## 16. Existing Quality / Status Semantics

### 16.1 Source Status (`source_status` table)

**Operational status, not data quality:**

| Field | Values | Meaning |
|---|---|---|
| `status` | `OK`, `PARTIAL`, `FAILED` | Whether the collector attempt succeeded |
| `lastAttempt` | timestamp | When the last collection was attempted |
| `lastSuccess` | timestamp (nullable) | When the last successful collection occurred |
| `recordsCollected` | integer | Number of records collected (e.g., 200 klines) |
| `errorMessage` | text (nullable) | Error details on failure |

**This is NOT the P6-01D quality_status.** It is an operational health metric for the collector, not a per-observation quality assessment.

### 16.2 Feature-Level Quality Indicators

The `features` table carries:

| Field | Type | Meaning |
|---|---|---|
| `confidenceScore` | real | 0-100 weighted score based on source availability |
| `dataCompleteness` | real | Percentage of expected sources that returned data |
| `missingSources` | jsonb | Array of source names that failed |

**These measure source availability, not observation validity.** A source can return INVALID data and still be counted as "available."

### 16.3 Square Opportunity Quality

The Square pipeline uses `dataQuality` field (HIGH/MEDIUM/LOW) on opportunities — this is a pipeline quality assessment, not an observation quality assessment.

---

## 17. Existing Test Coverage

### 17.1 P6 Tests

| Test File | Coverage | Quality Tests? |
|---|---|---|
| `src/lib/p6/registry/__tests__/registry-model.test.ts` | 33 tests — registry model validation | **No observation quality tests** |
| `src/lib/p6/freshness/__tests__/evaluator.test.ts` | 37 tests — freshness evaluation | **No quality tests** |
| `src/lib/p6/freshness/__tests__/freshness-v1-policies.test.ts` | 38 tests — V1 policy configuration | **No quality tests** |

### 17.2 P3 Tests

| Test File | Coverage |
|---|---|
| `src/lib/p3/__tests__/breadth.test.ts` | Breadth calculation tests |

### 17.3 No Collector Tests

**There are NO tests for:**
- Binance collector response parsing
- CoinGecko collector response parsing
- Null/missing/NaN handling in collectors
- OHLC relationship validation
- Numeric range validation
- Timestamp validation
- Entity mapping validation
- Duplicate handling at application level
- Partial payload handling
- API failure behavior

### 17.4 No Feature Input Validation Tests

**There are NO tests for:**
- Feature engine behavior with negative prices
- Feature engine behavior with NaN values
- Feature engine behavior with zero volumes
- Feature engine behavior with impossible OHLC relationships

---

## 18. Reusable Components

### 18.1 Candidates for P6 Quality Infrastructure

| Component | Current Location | Reuse Potential |
|---|---|---|
| `source_status` tracking | `source_status` table + refresh route | Operational health input — NOT quality, but reusable as quality signal |
| `dataCompleteness` | `features.dataCompleteness` | Source availability metric — extendable to quality |
| `missingSources` | `features.missingSources` | Source failure tracking — directly reusable |
| `confidenceScore` | `features.confidenceScore` | Source availability weighted score — reference for quality confidence |
| `onConflictDoUpdate` pattern | Refresh route | Deduplication pattern — align with P6-01B observation identity |
| `getBusinessDate()` | `src/lib/utils.ts` | Business day calculation — reusable for `business_date` |
| `preparePriceSeries()` | `src/lib/features/calculator.ts` | Price data preparation — could add validation |
| `runFeatureEngine()` | `src/lib/features/engine.ts` | Insufficient data guard (20 rows) — extendable to quality assessment |

### 18.2 What Must NOT Be Modified

Per P6-01D constraints:
- P4 decision support semantics
- P5 policy/safety/approval/permission
- Existing `source_status` table semantics
- Existing `features` table schema (may extend, not replace)
- Existing `market_price_daily` semantics
- Existing `coin_metrics` semantics
- Square pipeline

---

## 19. Gaps

### 19.1 Critical Gaps (Must Address Before Quality Contract)

| # | Gap | Impact | Current Behavior |
|---|---|---|---|
| G1 | **No observation-level quality_status** | Cannot assess individual observation validity | All observations assumed valid if insert succeeds |
| G2 | **No numeric validation** | NaN, Infinity, negative values can propagate | parseFloat() without checks; DB rejects NaN/Infinity at insert |
| G3 | **No OHLC relationship validation** | Impossible price relationships accepted | HIGH < LOW would be persisted |
| G4 | **No observed_at storage** | Cannot trace observation provenance | Only business_date stored; no observation timestamp |
| G5 | **No collected_at storage** | Cannot measure data freshness | Only createdAt (auto-generated) |
| G6 | **No validation layer between collector and persistence** | All validation is implicit (DB type check) | No application-level validation |

### 19.2 High-Value Gaps (Should Address in Quality Contract)

| # | Gap | Impact |
|---|---|---|
| G7 | No metric-specific null classification | Null could mean "source unavailable" or "legitimately null" |
| G8 | No source consistency validation | Spot vs Futures data could conflict silently |
| G9 | No timestamp validation | Future or very old timestamps accepted |
| G10 | No partial observation quality tracking | Partial source data tracked as binary (available/unavailable) |
| G11 | No validation test coverage | Quality regressions cannot be detected |

### 19.3 Future Gaps (Address After V1 Quality)

| # | Gap | Impact |
|---|---|---|
| G12 | No raw observation retention | Cannot reproduce or audit historical calculations |
| G13 | No quality reason tracking | Quality status without explanation |
| G14 | No quality-freshness correlation | Quality and freshness operate independently but have no unified view |
| G15 | No quality-aware downstream propagation | Feature engine does not check observation quality before calculation |

---

## 20. Candidate Semantic Decisions

The following questions require **Planner/Owner decisions**. They are NOT decided by this recon.

| # | Question | Impact |
|---|---|---|
| SD-01 | What constitutes INVALID for each metric? (e.g., negative price, HIGH < LOW, NaN) | Defines INVALID rules |
| SD-02 | What constitutes MISSING vs. UNKNOWN for each metric? | Defines MISSING/UNKNOWN boundary |
| SD-03 | Should OHLC relationship violations be INVALID at the observation level? | OHLC validation scope |
| SD-04 | Should negative VOLUME/MC/FDV/OI be INVALID or UNKNOWN? | Negative value policy |
| SD-05 | Should zero values for non-zero-expected metrics be INVALID? | Zero value policy |
| SD-06 | Should malformed numeric strings (NaN after parseFloat) be INVALID or MISSING? | NaN classification |
| SD-07 | Should partial source data produce INVALID for missing fields or UNKNOWN? | Partial data policy |
| SD-08 | Should quality be computed at write time, query time, or both? | Quality computation timing |
| SD-09 | Should quality status be stored on the observation or computed dynamically? | Quality persistence model |
| SD-10 | Should the existing `dataCompleteness` be replaced by P6 quality or coexist? | Migration strategy |
| SD-11 | Should source consistency (Spot vs Futures disagreement) be a quality signal? | Cross-source validation |
| SD-12 | Should the existing `source_status` (OK/PARTIAL/FAILED) be unified with P6 quality? | Operational vs. semantic quality |
| SD-13 | What is the relationship between `features.missingSources` and P6 MISSING quality? | Quality source tracking |
| SD-14 | Should quality assessment propagate to derived metrics (features, health scores)? | Quality propagation |
| SD-15 | Should there be quality-aware confidence weighting? (Invalid data reduces confidence more than missing data) | Quality-weighted confidence |

---

## 21. P6-01B / P6-01C Compatibility

### 21.1 Observation Identity

- P6-01B defines identity as `(entity_id, metric, source, observed_at, timeframe)`
- Current `market_price_daily` identity is `(coinId, date)` — less granular
- Current `coin_metrics` identity is `(coinId, date, source)` — partially aligned
- **Compatibility:** P6 quality must work with both the current (coarse) and future (fine-grained) identity models

### 21.2 observed_at Semantics

- P6-01B: `observed_at = UNKNOWN` when source does not provide timestamp
- Current: `observed_at` is NOT stored at all
- P6-01C-E1 confirmed all SOURCE_SNAPSHOT observed_at is UNKNOWN
- **Compatibility:** P6 quality must not depend on `observed_at` being available

### 21.3 collected_at Semantics

- P6-01B: `collected_at` is actual ingestion timestamp, never substitutes for `observed_at`
- Current: `createdAt: defaultNow()` in Drizzle schema — approximately equals collected_at
- **Compatibility:** Existing `createdAt` can serve as a proxy for `collected_at` until P6 persistence adds explicit field

### 21.4 Source Provenance

- P6-01B: Provenance for RAW → CANONICAL boundary
- Current: `source` column in `market_price_daily` and `coin_metrics`; `features.sourceProvenance` JSON
- **Compatibility:** P6 quality can reference existing `source` fields for provenance

### 21.5 Freshness Independence

- P6-01D states quality and freshness are independent dimensions
- Current: No freshness model (P6-01C implements one)
- **Compatibility:** P6 quality must not infer freshness from quality or vice versa

---

## 22. P4/P5 Boundary

### 22.1 Current Quality Behavior in P4/P5

- P4 uses `features.confidenceScore` and `features.dataCompleteness` for decision confidence
- P5 uses the full feature set for action decisions
- **Neither P4 nor P5 currently checks observation-level quality**

### 22.2 Boundary Assessment

P6-01D quality implementation must NOT:
- Change P4's use of `confidenceScore` or `dataCompleteness`
- Change P5's policy/safety/approval vocabulary
- Modify recommendation signals based on observation quality
- Introduce quality-based buy/sell logic

P6-01D quality implementation MAY:
- Add quality metadata alongside existing features
- Provide quality information to downstream consumers as additive metadata
- Enable quality-aware confidence in the future (separate task)

---

## 23. Exact Files Inspected

### Collectors
- `src/lib/collectors/binance.ts` — All Binance collection functions
- `src/lib/collectors/coingecko.ts` — All CoinGecko collection functions

### Data Flow
- `src/app/api/refresh/route.ts` — Full refresh orchestration (1041 lines)
- `src/lib/features/engine.ts` — Feature engine orchestration
- `src/lib/features/calculator.ts` — Core math functions (EMA, ROC, ATR, SMA)
- `src/lib/features/derivative.ts` — Derivative score calculation
- `src/lib/features/confidence.ts` — Confidence score calculation

### Schema
- `src/db/schema.ts` — Full database schema
- `drizzle/migrations/0000_pretty_warhawk.sql` — Base migration (constraints)
- `drizzle/migrations/0025_add_source_registry.sql` — P6 registry tables
- `drizzle/migrations/0026_add_freshness_policies.sql` — P6 freshness tables

### P6 Implementation
- `src/lib/p6/registry/types.ts` — P6 source registry types
- `src/lib/p6/registry/service.ts` — P6 registry service
- `src/lib/p6/freshness/types.ts` — P6 freshness types
- `src/lib/p6/freshness/evaluator.ts` — P6 freshness evaluator
- `src/lib/p6/freshness/service.ts` — P6 freshness service

### P6 Tests
- `src/lib/p6/registry/__tests__/registry-model.test.ts` — 33 tests
- `src/lib/p6/freshness/__tests__/evaluator.test.ts` — 37 tests
- `src/lib/p6/freshness/__tests__/freshness-v1-policies.test.ts` — 38 tests

### Authoritative Documents
- `docs/P6_Upgrade/P6-01B_OBSERVATION_CONTRACT.md`
- `docs/P6_Upgrade/P6-01C_SOURCE_REGISTRY_CONTRACT.md`
- `docs/P6_Upgrade/P6-01C_FRESHNESS_POLICY_CONTRACT.md`
- `docs/P6_Upgrade/P6-01C-E_FRESHNESS_V1_POLICY_DECISION.md`
- `docs/P6_Upgrade/P6-01C-E1_SNAPSHOT_CADENCE_RECON.md`
- `docs/P6_Upgrade/P6-01A_DATA_LANDSCAPE_RECON.md`
- `docs/P6_Upgrade/P6_00_EXECUTION_PLAN_REVISION_01.md`
- `docs/P5_Upgrade/P4-P5_HANDOFF.md`

---

## 24. Verification

| Check | Result |
|---|---|
| Source scan | ✅ All three source families inspected (Binance Spot, Binance Futures, CoinGecko) |
| Documentation scan | ✅ All mandatory P6/P5 documents read |
| All 10 canonical metrics considered | ✅ OPEN, HIGH, LOW, CLOSE, VOLUME, QUOTE_VOLUME, MARKET_CAP, FDV, OPEN_INTEREST, FUNDING_RATE |
| Existing quality semantics inventoried | ✅ source_status, dataCompleteness, missingSources, confidenceScore |
| Gaps identified | ✅ 15 gaps classified (G1-G15) |
| Semantic decisions listed | ✅ 15 candidate decisions (SD-01 to SD-15) |
| P6-01B preserved | ✅ No modifications |
| P6-01C preserved | ✅ No modifications |
| P4/P5 preserved | ✅ No modifications |
| No production changes | ✅ Documentation only |
| Only recon document changed | ✅ Git boundary clean |
| Tests/typecheck not modified | ✅ No test or source changes |

---

**P6-01D-A DATA QUALITY LANDSCAPE RECON — COMPLETE**
**NO PRODUCTION CODE CHANGES**
**NO SCHEMA CHANGES**
**NO API CHANGES**
**NO P4/P5 CONTRACT CHANGES**
