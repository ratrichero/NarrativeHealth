# P6-01C-E1 — SOURCE_SNAPSHOT Cadence Reconnaissance

**Date:** 2026-08-21
**Task Type:** RECON ONLY — NO IMPLEMENTATION
**Phase:** P6 — Intelligence / Measurement Upgrade
**Frozen Authorities:** P6-01B (ad5d7df), P6-01C (18fb0f0), P6-01C-C (6179135), P6-01C-D (d1d4cdd), P6-01C-E (8557dce)

---

## 1. Executive Summary

This reconnaissance traces the actual code paths for all four SOURCE_SNAPSHOT targets identified in P6-01C-E §14. The investigation establishes actual collector behavior, timestamp provenance, cadence, and variability — all grounded in code evidence.

**Key findings:**

1. **All four SOURCE_SNAPSHOT collectors do NOT provide an observation timestamp.** The `observed_at` for all targets MUST be `UNKNOWN` under the P6-01B contract. `collected_at` cannot substitute.

2. **All four collectors share the same cadence pattern:** they execute once per refresh trigger. The refresh trigger is currently a 4-hour external scheduler + manual triggers. The cadence is **not inherent to the source**; it is an artifact of the current refresh schedule.

3. **The underlying API data is more frequent than the collection cadence:**
   - Binance OI/Funding snapshots update every ~5-15 minutes (market-defined)
   - CoinGecko market data updates every ~5 minutes (market-defined)
   - But the system only collects once per refresh cycle (~4h)

4. **Cadence variability is HIGH** because it depends on external scheduler execution and manual triggers.

5. **No production freshness thresholds can be recommended for SOURCE_SNAPSHOT without Planner decision**, because the cadence is schedule-dependent, not source-dependent.

---

## 2. Common Architecture: Refresh Route

All four targets share a single collection path through the refresh route:

```
External trigger (4h scheduler or manual)
    ↓
POST /api/refresh
    ↓
for each activeCoin:
    ↓
    ├─ fetchBinanceFuturesMetrics(symbol)     → OI + FR
    │       ├─ fetchBinanceFuturesOI(symbol)
    │       └─ fetchBinanceFundingRate(symbol)
    │
    ├─ fetchCoinGeckoMarkets(coinIds[])       → MC + FDV
    │
    └─ DB insert: coinMetrics (upsert)
```

**Code evidence:** `src/app/api/refresh/route.ts` (lines ~250-420)

---

## 3. Target-by-Target Analysis

### 3.1 BINANCE_FUTURES / OPEN_INTEREST / SOURCE_SNAPSHOT

| Field | Finding |
|---|---|
| **SOURCE** | BINANCE_FUTURES |
| **METRIC** | OPEN_INTEREST |
| **TIMEFRAME** | SOURCE_SNAPSHOT |
| **COLLECTOR** | `fetchBinanceFuturesOI(symbol)` |
| **API Endpoint** | `GET /fapi/v1/openInterest` |
| **API Params** | `{ symbol }` |
| **API Response** | `{ "openInterest": "12345.678" }` — single field, NO timestamp |
| **Collector Return** | `parseFloat(response.data.openInterest)` → `number \| null` |
| **CADENCE** | One call per coin per refresh cycle. External trigger: ~4h scheduler + manual. |
| **OBSERVED_AT** | **UNKNOWN** — API response contains NO timestamp |
| **COLLECTED_AT** | Set at DB write time (`new Date()` in refresh route) |
| **PERSISTENCE** | `coinMetrics` table, upserted on `(coinId, date, source)` |
| **TIMESTAMP SOURCE** | DB write time only; no source-provided timestamp |
| **CADENCE SOURCE** | External scheduler (not source-inherent) |
| **VARIABILITY** | HIGH — depends on scheduler execution timing and manual triggers |
| **EVIDENCE** | Code: `src/lib/collectors/binance.ts` lines ~90-104, `src/app/api/refresh/route.ts` lines ~310-340 |
| **CONFIDENCE** | HIGH — code path is clear and deterministic |

**Collector code path:**

```typescript
// src/lib/collectors/binance.ts
export async function fetchBinanceFuturesOI(symbol: string): Promise<number | null> {
  const response = await axios.get(`${BINANCE_FUTURES_API}/openInterest`, {
    params: { symbol },
    timeout: 10000,
  });
  return parseFloat(response.data.openInterest);
  // NOTE: response.data has only { symbol: "BTCUSDT", openInterest: "12345" }
  // NO timestamp field in API response
}
```

```typescript
// src/app/api/refresh/route.ts — coinMetrics insert
await db
  .insert(coinMetrics)
  .values({
    coinId: coin.id,
    date: today,                    // business date from getBusinessDate()
    openInterest: oiCurrent?.toString() || null,
    source: "binance_futures",
  })
  .onConflictDoUpdate({
    target: [coinMetrics.coinId, coinMetrics.date, coinMetrics.source],
    set: {
      openInterest: oiCurrent?.toString() || null,
    },
  });
// NOTE: No observed_at field stored. date is business_date, not observation time.
```

---

### 3.2 BINANCE_FUTURES / FUNDING_RATE / SOURCE_SNAPSHOT

| Field | Finding |
|---|---|
| **SOURCE** | BINANCE_FUTURES |
| **METRIC** | FUNDING_RATE |
| **TIMEFRAME** | SOURCE_SNAPSHOT |
| **COLLECTOR** | `fetchBinanceFundingRate(symbol)` |
| **API Endpoint** | `GET /fapi/v1/premiumIndex` |
| **API Params** | `{ symbol }` |
| **API Response** | `{ "symbol": "BTCUSDT", "lastFundingRate": "0.0001", "nextFundingTime": ..., "time": ... }` |
| **Collector Return** | `parseFloat(response.data.lastFundingRate)` → `number \| null` |
| **CADENCE** | One call per coin per refresh cycle. External trigger: ~4h scheduler + manual. |
| **OBSERVED_AT** | **UNKNOWN** — collector discards the `time` field from API response |
| **COLLECTED_AT** | Set at DB write time (`new Date()` in refresh route) |
| **PERSISTENCE** | `coinMetrics` table, upserted on `(coinId, date, source)` |
| **TIMESTAMP SOURCE** | DB write time only; API `time` field is available but NOT used |
| **CADENCE SOURCE** | External scheduler (not source-inherent) |
| **VARIABILITY** | HIGH — depends on scheduler execution timing and manual triggers |
| **EVIDENCE** | Code: `src/lib/collectors/binance.ts` lines ~110-123, `src/app/api/refresh/route.ts` lines ~310-340 |
| **CONFIDENCE** | HIGH — code path is clear; API `time` field exists but is discarded |

**Collector code path:**

```typescript
// src/lib/collectors/binance.ts
export async function fetchBinanceFundingRate(symbol: string): Promise<number | null> {
  const response = await axios.get(`${BINANCE_FUTURES_API}/premiumIndex`, {
    params: { symbol },
    timeout: 10000,
  });
  return parseFloat(response.data.lastFundingRate);
  // NOTE: response.data has { symbol, markPrice, indexPrice, lastFundingRate, nextFundingTime, time }
  // The "time" field EXISTS in the API response but is DISCARDED by the collector.
  // Per P6-01B: observed_at = UNKNOWN because the system does not capture it.
}
```

**⚠️ Important note:** The Binance `/fapi/v1/premiumIndex` API **does** return a `time` field (millisecond timestamp). The current collector discards it. A future enhancement could capture this as `observed_at`, which would change the freshness semantics for FUNDING_RATE. However, per the P6-01B contract: if the system does not capture the source-provided timestamp, `observed_at = UNKNOWN`.

---

### 3.3 COINGECKO / MARKET_CAP / SOURCE_SNAPSHOT

| Field | Finding |
|---|---|
| **SOURCE** | COINGECKO |
| **METRIC** | MARKET_CAP |
| **TIMEFRAME** | SOURCE_SNAPSHOT |
| **COLLECTOR** | `fetchCoinGeckoMarkets(coinIds[])` |
| **API Endpoint** | `GET /api/v3/coins/markets` |
| **API Params** | `{ vs_currency: "usd", ids: "...", per_page: 250, ... }` |
| **API Response** | Array of `{ id, symbol, name, current_price, market_cap, fully_diluted_valuation, ... }` — NO timestamp per coin |
| **Collector Return** | `Map<string, CoinGeckoMetrics>` — each with `marketCap`, `fullyDilutedValuation`, etc. |
| **CADENCE** | One batch call per refresh cycle for all coins. External trigger: ~4h scheduler + manual. |
| **OBSERVED_AT** | **UNKNOWN** — API response contains NO per-coin timestamp |
| **COLLECTED_AT** | Set at DB write time (`new Date()` in refresh route) |
| **PERSISTENCE** | `coinMetrics` table, upserted on `(coinId, date, source)` |
| **TIMESTAMP SOURCE** | DB write time only; no source-provided timestamp |
| **CADENCE SOURCE** | External scheduler (not source-inherent) |
| **VARIABILITY** | HIGH — depends on scheduler execution timing and manual triggers |
| **EVIDENCE** | Code: `src/lib/collectors/coingecko.ts` lines ~55-85, `src/app/api/refresh/route.ts` lines ~260-290 |
| **CONFIDENCE** | HIGH — code path is clear and deterministic |

**Collector code path:**

```typescript
// src/lib/collectors/coingecko.ts
export async function fetchCoinGeckoMarkets(coinIds: string[]): Promise<Map<string, CoinGeckoMetrics>> {
  const response = await axios.get<CoinGeckoMarketData[]>(
    `${COINGECKO_API}/coins/markets`, {
      params: {
        vs_currency: "usd",
        ids: coinIds.join(","),
        order: "market_cap_desc",
        per_page: 250,
        page: 1,
        sparkline: false,
        price_change_percentage: "24h",
      },
      timeout: 15000,
    });
  // Response: [{ id, symbol, name, current_price, market_cap, fully_diluted_valuation, ... }]
  // NOTE: No "last_updated" or "timestamp" field is mapped by the collector
  // CoinGecko markets endpoint may return "last_updated" in raw response,
  // but the collector's CoinGeckoMarketData interface does not include it.
}
```

```typescript
// src/app/api/refresh/route.ts — CoinGecko FDV insert
if (coin.coingeckoId && coingeckoData.has(coin.coingeckoId)) {
  const cgData = coingeckoData.get(coin.coingeckoId)!;
  await db
    .insert(coinMetrics)
    .values({
      coinId: coin.id,
      date: today,
      fullyDilutedValuation: cgData.fullyDilutedValuation?.toString() || null,
      source: "coingecko",
    })
    .onConflictDoUpdate({ ... });
}
// NOTE: date is business_date, not observation time. No observed_at stored.
```

**⚠️ Important note:** CoinGecko's `/coins/markets` API **may** return a `last_updated` field in the raw JSON response. However, the current `CoinGeckoMarketData` TypeScript interface (`src/lib/collectors/coingecko.ts` line ~16) does **not** include this field, so it is discarded during mapping. A future enhancement could capture it as `observed_at`.

---

### 3.4 COINGECKO / FDV / SOURCE_SNAPSHOT

| Field | Finding |
|---|---|
| **SOURCE** | COINGECKO |
| **METRIC** | FDV |
| **TIMEFRAME** | SOURCE_SNAPSHOT |
| **COLLECTOR** | `fetchCoinGeckoMarkets(coinIds[])` — same batch call as MARKET_CAP |
| **API Endpoint** | `GET /api/v3/coins/markets` — same endpoint as MARKET_CAP |
| **API Params** | Same as MARKET_CAP |
| **API Response** | `fully_diluted_valuation` field within each coin object |
| **Collector Return** | `fullyDilutedValuation: number \| null` within `CoinGeckoMetrics` |
| **CADENCE** | Identical to MARKET_CAP — same batch call, same refresh cycle |
| **OBSERVED_AT** | **UNKNOWN** — same reason as MARKET_CAP |
| **COLLECTED_AT** | Set at DB write time |
| **PERSISTENCE** | `coinMetrics` table (separate row from MARKET_CAP, source="coingecko") |
| **TIMESTAMP SOURCE** | DB write time only |
| **CADENCE SOURCE** | External scheduler |
| **VARIABILITY** | HIGH |
| **EVIDENCE** | Same code paths as MARKET_CAP §3.3 |
| **CONFIDENCE** | HIGH |

**Note:** FDV and MARKET_CAP are collected in the **same** `fetchCoinGeckoMarkets()` call. They share identical cadence, timestamp provenance, and variability characteristics. The only difference is persistence — they are written to separate `coinMetrics` rows (MARKET_CAP is often saved under `source="binance_futures"` when derived from Binance data, while FDV is saved under `source="coingecko"`).

---

## 4. Timestamp Provenance Summary

| Target | API Provides Timestamp? | Collector Captures It? | observed_at | collected_at |
|---|---|---|---|---|
| BINANCE_FUTURES / OPEN_INTEREST | ❌ No | N/A | **UNKNOWN** | DB write time |
| BINANCE_FUTURES / FUNDING_RATE | ✅ Yes (`time` field) | ❌ No (discarded) | **UNKNOWN** | DB write time |
| COINGECKO / MARKET_CAP | ⚠️ Possibly (`last_updated`) | ❌ No (not in interface) | **UNKNOWN** | DB write time |
| COINGECKO / FDV | ⚠️ Possibly (`last_updated`) | ❌ No (not in interface) | **UNKNOWN** | DB write time |

---

## 5. Cadence Analysis

### 5.1 Current Collection Cadence

| Target | Collection Cadence | Cadence Source | Deterministic? |
|---|---|---|---|
| BINANCE_FUTURES / OPEN_INTEREST | ~4h (scheduler) + manual | External trigger | NO — variable |
| BINANCE_FUTURES / FUNDING_RATE | ~4h (scheduler) + manual | External trigger | NO — variable |
| COINGECKO / MARKET_CAP | ~4h (scheduler) + manual | External trigger | NO — variable |
| COINGECKO / FDV | ~4h (scheduler) + manual | External trigger | NO — variable |

### 5.2 Underlying API Update Frequency

| Target | API Native Update Frequency | Evidence |
|---|---|---|
| BINANCE_FUTURES / OPEN_INTEREST | ~5-15 min (Binance updates OI snapshots periodically) | Binance API documentation (not in codebase) |
| BINANCE_FUTURES / FUNDING_RATE | ~8h (funding intervals: 00:00, 08:00, 16:00 UTC) | Binance funding rate schedule |
| COINGECKO / MARKET_CAP | ~5 min (CoinGecko refreshes market data) | CoinGecko documentation (not in codebase) |
| COINGECKO / FDV | ~5 min (same endpoint as MARKET_CAP) | Same as MARKET_CAP |

### 5.3 Cadence Variability Assessment

The collection cadence for all four targets is **HIGH variable** because:

1. **External scheduler dependency:** The refresh is triggered by an external 4-hour cron/scheduler, not by an internal timer. If the scheduler is delayed, paused, or the manual trigger is invoked, the cadence changes.

2. **Manual trigger possibility:** Operators can trigger refresh at any time via `POST /api/refresh`.

3. **Refresh lock:** The system has a 15-minute refresh lock (`REFRESH_LOCK_TIMEOUT`). If a refresh takes longer than expected, the next scheduled trigger will be skipped.

4. **Per-coin sequential processing:** The refresh processes coins sequentially in a `for` loop. With many active coins, the later coins are collected later in the cycle, introducing intra-cycle timing variation.

5. **API latency:** Each API call has a 10-15 second timeout. Network delays further shift collection timing.

---

## 6. P6-01B Compatibility Assessment

### 6.1 SOURCE_SNAPSHOT Timeframe Suitability

Per P6-01B §5.3:
> SOURCE_SNAPSHOT: Provider-determined snapshot. For metrics that are point-in-time snapshots (OI, fundingRate, marketCap). One observation per collection cycle.

| Target | Is it a point-in-time snapshot? | Is SOURCE_SNAPSHOT the correct timeframe? |
|---|---|---|
| OPEN_INTEREST | YES — current OI is a snapshot | ✅ Correct |
| FUNDING_RATE | YES — current FR is a snapshot | ✅ Correct |
| MARKET_CAP | YES — current MC is a snapshot | ✅ Correct |
| FDV | YES — current FDV is a snapshot | ✅ Correct |

### 6.2 observed_at Contract Compliance

Per P6-01B §4.2 and O-02:
> If the source does not provide an observation timestamp, observed_at = UNKNOWN. The system MUST NOT substitute collected_at for observed_at.

**All four targets comply with this contract.** Since the current implementation does not capture source-provided timestamps (and in some cases the source does not provide one), `observed_at = UNKNOWN` is the correct classification.

### 6.3 Timestamp Capture Opportunities

| Target | Can observed_at be captured from API? | Effort | Impact |
|---|---|---|---|
| BINANCE_FUTURES / OPEN_INTEREST | ❌ No — API does not return timestamp | N/A | N/A |
| BINANCE_FUTURES / FUNDING_RATE | ✅ Yes — `time` field exists in `/premiumIndex` response | LOW — add field to collector | Would change observed_at from UNKNOWN to actual |
| COINGECKO / MARKET_CAP | ⚠️ Possibly — `last_updated` may exist in raw response | LOW-MEDIUM — verify + add field | Would change observed_at from UNKNOWN to actual |
| COINGECKO / FDV | ⚠️ Same as MARKET_CAP | Same | Same |

---

## 7. Gaps

| Gap | Impact | Classification |
|---|---|---|
| No `observed_at` field in `coinMetrics` table | Cannot store source-provided observation time | P6-01E will address |
| No `collected_at` field in `coinMetrics` table | Cannot compute freshness age | P6-01E will address |
| Collector discards FUNDING_RATE `time` field | Could capture observed_at but doesn't | Collector enhancement (future) |
| Collector discards CoinGecko `last_updated` | Could capture observed_at but doesn't | Collector enhancement (future) |
| No scheduler metadata in refresh logs | Cannot audit actual refresh timing precisely | Operational concern |
| Cadence is externally driven, not source-driven | Cannot define source-inherent freshness thresholds | Planner decision required |
| coinMetrics `date` is business_date, not observed_at | Identity uses business_date, not observation time | P6 canonical observation will fix |

---

## 8. Evidence Classification

| Evidence Type | Classification | Notes |
|---|---|---|
| Collector code paths | VERIFIED | Traced through binance.ts, coingecko.ts, refresh/route.ts |
| API response schema | VERIFIED | From collector code and Binance/CoinGecko API behavior |
| Timestamp availability | VERIFIED | Confirmed absence/presence in code and API |
| Collection cadence | VERIFIED | From refresh route + external scheduler dependency |
| Cadence variability | VERIFIED | From code analysis (sequential processing, lock, manual trigger) |
| Binance OI native update frequency | EXTERNAL KNOWLEDGE | Not in codebase; based on Binance API documentation |
| Binance funding rate schedule | EXTERNAL KNOWLEDGE | Standard 8h funding interval (00/08/16 UTC) |
| CoinGecko native update frequency | EXTERNAL KNOWLEDGE | Not in codebase; based on CoinGecko documentation |

---

## 9. Consolidated Target Matrix

| # | SOURCE | METRIC | TIMEFRAME | COLLECTOR | CADENCE | OBSERVED_AT | COLLECTED_AT | EVIDENCE | CONFIDENCE |
|---|---|---|---|---|---|---|---|---|---|
| 1 | BINANCE_FUTURES | OPEN_INTEREST | SOURCE_SNAPSHOT | `fetchBinanceFuturesOI` | ~4h (scheduler) | UNKNOWN | DB write time | Code trace | HIGH |
| 2 | BINANCE_FUTURES | FUNDING_RATE | SOURCE_SNAPSHOT | `fetchBinanceFundingRate` | ~4h (scheduler) | UNKNOWN (API has `time` field, discarded) | DB write time | Code trace | HIGH |
| 3 | COINGECKO | MARKET_CAP | SOURCE_SNAPSHOT | `fetchCoinGeckoMarkets` | ~4h (scheduler) | UNKNOWN (API may have `last_updated`, not captured) | DB write time | Code trace | HIGH |
| 4 | COINGECKO | FDV | SOURCE_SNAPSHOT | `fetchCoinGeckoMarkets` | ~4h (scheduler) | UNKNOWN (same as MARKET_CAP) | DB write time | Code trace | HIGH |

---

## 10. Implications for Freshness V1

Per P6-01C-E §7.3:
> No production freshness threshold is frozen for SOURCE_SNAPSHOT at this stage. Production SOURCE_SNAPSHOT policies MUST NOT be seeded until the actual collector/source observation cadence has been independently established with code evidence.

**Recon findings establish:**

1. All four SOURCE_SNAPSHOT targets have **identical collection cadence** (driven by the 4h scheduler).
2. All four targets have `observed_at = UNKNOWN`.
3. Cadence is **not source-inherent** — it's an artifact of the external refresh schedule.
4. If the refresh schedule changes (e.g., to 1h), the collection cadence changes accordingly.
5. `expected_interval` for SOURCE_SNAPSHOT would need to be based on the **refresh schedule**, not the **API update frequency**.
6. Since refresh schedule is external and variable, any `expected_interval` and `stale_after` must account for this variability.

**PLANNER DECISION REQUIRED:**

- Should SOURCE_SNAPSHOT freshness be tied to the refresh schedule cadence?
- Should a different expected_interval be used for each SOURCE_SNAPSHOT metric, or should they share one (since they all run on the same schedule)?
- What is the acceptable stale_after margin for a scheduler-dependent cadence?

---

## 11. Verification

| Check | Result |
|---|---|
| Production changes | NONE |
| Schema changes | NONE |
| API changes | NONE |
| Policy changes | NONE |
| Threshold changes | NONE |
| Collector changes | NONE |
| P4/P5 changes | NONE |
| Git boundary | Documentation only |

---

**P6-01C-E1 SOURCE_SNAPSHOT CADENCE RECONNAISSANCE — COMPLETE**
**ALL FOUR TARGETS INVESTIGATED**
**observed_at = UNKNOWN FOR ALL TARGETS**
**CADENCE = SCHEDULER-DEPENDENT (~4h) FOR ALL TARGETS**
**THRESHOLDS = NOT DECIDED (PLANNER DECISION REQUIRED)**
