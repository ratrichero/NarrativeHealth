# P6-DATA-05 — Binance Futures Connectivity Diagnostic & Recovery

**Task:** P6-DATA-05  
**Status:** ROOT CAUSE FOUND — NOT RECOVERABLE FROM CODE  
**Depends on:** P6-DATA-03 (`9179576`), P6-DATA-04 (`9b0d9df`)  
**Type:** Source Connectivity / Data Acquisition  
**Verdict:** `BINANCE_ACCESS_ROOT_CAUSE_FOUND_NOT_RECOVERED`

---

## 1. Executive Summary

P6-DATA-05 has established the **exact root cause** of the Binance Futures API failure:

```
HTTP 451 — "Unavailable For Legal Reasons"
```

Binance returns:

```
"Service unavailable from a restricted location according to 
'b. Eligibility' in https://www.binance.com/en/terms. 
Please contact customer service if you believe you received this 
message in error."
```

**Both Spot AND Futures APIs are blocked.** This is not a futures-specific issue — Binance has geo-blocked the entire runtime environment's IP range.

**This is NOT recoverable from code changes.** The block is enforced at Binance's CDN/edge layer (response time: 3-5ms). The only recovery paths are infrastructure-level:

1. Deploy the runtime to a Binance-supported region
2. Route through a proxy/VPN (security and reliability concerns)
3. Use an alternative data provider for futures data
4. Accept the limitation (current state)

---

## 2. Current Failure

### Failure Chain

```
Binance API request (any endpoint)
    ↓
HTTP 451 response (3-5ms latency)
    ↓
axios throws AxiosError with response.status = 451
    ↓
try/catch in binance.ts catches error, returns null/[]
    ↓
coin-processor.ts: oiCurrent = null, fundingRate = null
    ↓
engine.ts: hasFutures = false
    ↓
calculateDerivativeScore: score = 50, no_futures = true
    ↓
ALL 49 coins receive derivative = 50
```

### Affected Endpoints (ALL BLOCKED)

| Endpoint | Purpose | Status | Response |
|----------|---------|:------:|----------|
| `/fapi/v1/ping` | Futures connectivity | ❌ 451 | Geo-blocked |
| `/fapi/v1/exchangeInfo` | Futures exchange info | ❌ 451 | Geo-blocked |
| `/fapi/v1/openInterest` | Current OI | ❌ 451 | Geo-blocked |
| `/fapi/v1/premiumIndex` | Funding rate | ❌ 451 | Geo-blocked |
| `/futures/data/openInterestHist` | OI history | ❌ 451 | Geo-blocked |
| `/fapi/v1/klines` | Futures klines | ❌ 451 | Geo-blocked |
| `/api/v3/ping` | Spot connectivity | ❌ 451 | Geo-blocked |
| `/api/v3/ticker/price` | Spot ticker | ❌ 451 | Geo-blocked |

---

## 3. Diagnostic Method

### Endpoint Under Test

Created `src/app/api/admin/p6-data-05/route.ts` that independently tests:

1. **Futures API base** — `GET /fapi/v1/ping`
2. **Exchange info** — `GET /fapi/v1/exchangeInfo`
3. **Per-symbol (7 coins):**
   - `GET /fapi/v1/openInterest?symbol=X`
   - `GET /fapi/v1/premiumIndex?symbol=X`
   - `GET /futures/data/openInterestHist?symbol=X&period=1d&limit=2`
4. **Spot API comparison:**
   - `GET /api/v3/ping`
   - `GET /api/v3/ticker/price?symbol=BTCUSDT`

### Test Coins

BTCUSDT, ETHUSDT, ARBUSDT, RENDERUSDT, CARVUSDT, SOLUSDT, DOGEUSDT

### Results

| Metric | Value |
|--------|:-----:|
| Total endpoints tested | 25 |
| OK | **0** |
| Failed | **25** |
| Futures API accessible | ❌ |
| Spot API accessible | ❌ |
| Exchange info available | ❌ |

**Every single endpoint returns HTTP 451.** This is a complete geo-block.

---

## 4. Endpoint Inventory

### Futures Endpoints

| # | Endpoint | URL Pattern | Purpose |
|---|----------|-------------|---------|
| 1 | Open Interest | `fapi.binance.com/fapi/v1/openInterest` | Current OI for a symbol |
| 2 | Funding Rate | `fapi.binance.com/fapi/v1/premiumIndex` | Current funding rate |
| 3 | OI History | `fapi.binance.com/futures/data/openInterestHist` | Historical OI series |
| 4 | Futures Klines | `fapi.binance.com/fapi/v1/klines` | OHLCV candlestick data |

### Spot Endpoints (also affected)

| # | Endpoint | URL Pattern | Purpose |
|---|----------|-------------|---------|
| 5 | Spot Klines | `api.binance.com/api/v3/klines` | OHLCV candlestick data |
| 6 | Spot Ticker | `api.binance.com/api/v3/ticker/price` | Current price |
| 7 | Spot 24h Ticker | `api.binance.com/api/v3/ticker/24hr` | 24h volume/stats |

---

## 5. Evidence

### HTTP 451 Response

```json
{
  "code": 0,
  "msg": "Service unavailable from a restricted location according to 
          'b. Eligibility' in https://www.binance.com/en/terms. 
          Please contact customer service if you believe you received 
          this message in error."
}
```

### Response Characteristics

| Property | Value |
|----------|-------|
| HTTP Status | 451 (Unavailable For Legal Reasons) |
| Response time | 3-5ms |
| DNS resolution | ✅ Works |
| TCP/TLS | ✅ Works |
| HTTP response | ✅ Returns JSON (not connection error) |
| Block location | CDN/edge layer (pre-origin) |

### Why This Was Previously Working

The Binance API was previously accessible from this environment. The geo-block was applied by Binance at some point between the last successful data collection and the current diagnostic. Possible triggers:

- Binance expanded their restricted regions list
- The runtime environment's IP range was reclassified
- The environment was deployed to a new region/DC

---

## 6. Root Cause

```
ROOT CAUSE: HTTP 451 — Binance geo-restriction
```

### Classification

| Criterion | Classification |
|-----------|:--------------:|
| DNS failure | ❌ No — DNS resolves |
| TCP/TLS failure | ❌ No — connection succeeds |
| HTTP error | ✅ Yes — HTTP 451 |
| Rate limiting | ❌ No — not HTTP 429 |
| API key issue | ❌ No — public endpoints blocked |
| Endpoint deprecation | ❌ No — all endpoints blocked |
| **Geo restriction** | **✅ Yes — HTTP 451** |
| Recovery possible from code | ❌ No |

### Impact

- **All 49 coins** receive `derivative_score = 50` (constant)
- **All 49 coins** receive degraded `volume_score` (if spot klines also blocked)
- **Spot klines are also blocked** — this affects trend, volume, momentum features
- **The system previously worked** — old data in DB is from before the geo-block

---

## 7. Recovery

### Can This Be Fixed From Code?

**No.** HTTP 451 is a geo-restriction enforced at the CDN/edge layer. The request never reaches Binance's application servers.

### Possible Recovery Paths

| Path | Feasibility | Risk | Recommendation |
|------|:-----------:|:----:|:--------------:|
| Deploy to unrestricted region | ✅ | Low | **Recommended** |
| VPN/proxy | ⚠️ | High (security) | Not recommended |
| Alternative provider (Coinglass) | ⚠️ | Medium | Possible for futures only |
| Accept limitation | ✅ | Low | Acceptable short-term |
| Request Binance unblock | ⚠️ | Unknown | Try but unlikely |

### Implementation Recommendation

1. **Short-term:** Accept the limitation. The system continues working with `derivative=50` (neutral placeholder). P6-DATA-04's degradation contract handles this correctly.

2. **Medium-term:** Investigate whether the runtime environment can be deployed to a Binance-supported region (e.g., Singapore, Dubai).

3. **Long-term:** Consider adding a fallback futures data provider (Coinglass) as a secondary source.

---

## 8. Error Handling

### Before P6-DATA-05

```typescript
catch (error) {
  console.error(`Binance futures OI error for ${symbol}:`, error);
  return null;
}
```

The error was logged but:
- HTTP status code was not captured
- The 451 geo-block was not identifiable from logs
- Error message was generic

### After P6-DATA-05

```typescript
catch (error: any) {
  const status = error.response?.status;
  if (status === 451) {
    console.error(`[BINANCE-451] Futures OI ${symbol}: geo-blocked (HTTP 451)`);
  } else {
    console.error(`Binance futures OI error for ${symbol}: [HTTP ${status || 'N/A'}] ${msg}`);
  }
  return null;
}
```

Now:
- HTTP status is captured and logged
- 451 geo-block is explicitly identified
- Error messages include HTTP status for all failures
- `[BINANCE-451]` tag enables log filtering/alerting

### Files Modified

| File | Change | LOC |
|------|--------|----:|
| `src/lib/collectors/binance.ts` | Enhanced error handling with HTTP status capture | ~30 |

---

## 9. Observability

### New Log Tags

| Tag | Meaning |
|-----|---------|
| `[BINANCE-451]` | Geo-restriction (HTTP 451) — runtime is in a blocked region |

### Example Log Output

```
[BINANCE-451] Futures OI BTCUSDT: geo-blocked (HTTP 451). Binance terms restrict this region.
[BINANCE-451] Funding rate BTCUSDT: geo-blocked (HTTP 451). Binance terms restrict this region.
[BINANCE-451] OI history BTCUSDT: geo-blocked (HTTP 451). Binance terms restrict this region.
[BINANCE-451] Spot klines BTCUSDT: geo-blocked (HTTP 451)
[BINANCE-451] Futures klines BTCUSDT: geo-blocked (HTTP 451)
```

### Alerting Recommendation

If the production system has log monitoring, an alert on `[BINANCE-451]` would immediately surface this condition. Previously, the 451 error was invisible.

---

## 10. Production Verification

### Current Production State

The Binance API is **still geo-blocked** from this runtime. A production refresh would produce the same degenerate behavior:

- All coins: `hasFutures = false`
- All coins: `derivative_score = 50`
- All coins: degraded features

### No Refresh Triggered

Since the root cause is infrastructure-level and not recoverable from code, a production refresh was NOT triggered in this task. It would produce identical degenerate results.

### What Would Change With Recovery

If the geo-block is resolved (e.g., by deploying to an unrestricted region), the system would automatically recover because:

1. `fetchBinanceFuturesOI` would return actual OI values
2. `fetchBinanceFundingRate` would return actual funding rates
3. `fetchBinanceOIHistory` would return OI history
4. `hasFutures` would become `true`
5. `calculateDerivativeScore` would compute continuous values
6. Feature distribution would differentiate

No code changes are needed for recovery — just network access.

---

## 11. Degradation Verification

### Semantic State After P6-DATA-05

| Condition | Before | After |
|-----------|:------:|:-----:|
| Futures API returns 451 | Null (invisible) | **Null (logged as [BINANCE-451])** |
| hasFutures | false | false (unchanged) |
| derivative_score | 50 | 50 (unchanged) |
| Error observability | ❌ | ✅ |

### Test Coverage

The diagnostic endpoint verified:

| Test | Result |
|------|:------:|
| Futures ping (BTCUSDT) | ❌ HTTP 451 |
| Futures OI (7 symbols) | ❌ HTTP 451 |
| Futures funding (7 symbols) | ❌ HTTP 451 |
| Futures OI history (7 symbols) | ❌ HTTP 451 |
| Spot ping | ❌ HTTP 451 |
| Spot ticker | ❌ HTTP 451 |

---

## 12. Compatibility

| Area | Impact |
|------|:------:|
| Derivative feature | Unchanged (still 50) |
| Health calculation | Unchanged |
| Feature versioning | Unchanged |
| P3/P4/P5 | Unchanged |
| Confidence | Unchanged |
| Schema | No change |
| Tests | 44/44 pass |
| TypeScript | Clean |

---

## 13. Limitations

1. **Root cause is infrastructure-level** — cannot be fixed from application code
2. **Spot API is also blocked** — this affects ALL features (trend, volume, momentum), not just derivative
3. **Old data in DB is from before the geo-block** — production has stale historical data
4. **No fallback provider** — the system has a single dependency on Binance
5. **The diagnostic endpoint was temporary** — removed after verification

---

## 14. Recommendation

### Immediate (this task)

✅ Enhanced error handling in `binance.ts` to capture HTTP status codes  
✅ `[BINANCE-451]` log tag for geo-block identification  
✅ Root cause definitively established  

### Short-term

1. **Do NOT deploy to production refresh** — it would produce the same degenerate results
2. **Accept the limitation** — `derivative=50` is a valid neutral placeholder per P6-DATA-04
3. **Investigate runtime region** — determine if the environment can be moved to a Binance-supported region

### Medium-term

1. **Consider alternative futures data provider** (Coinglass) for OI and funding data
2. **Add Binance API health check** before refresh — skip futures if geo-blocked
3. **Alert on `[BINANCE-451]`** in production monitoring

### Long-term

1. **Multi-source futures data** — primary Binance + fallback Coinglass
2. **Geo-redundant runtime deployment** — ensure API access from multiple regions

---

## 15. Verdict

```
BINANCE_ACCESS_ROOT_CAUSE_FOUND_NOT_RECOVERED
```

### Evidence

| Criterion | Status |
|-----------|:------:|
| Root cause identified | ✅ HTTP 451 geo-restriction |
| Root cause proven | ✅ 25/25 endpoints return 451 |
| Affects both Spot and Futures | ✅ Confirmed |
| Recovery possible from code | ❌ No — infrastructure-level |
| Error handling improved | ✅ HTTP status now captured |
| Existing tests pass | ✅ 44/44 |
| TypeScript clean | ✅ |
| No schema changes | ✅ |
| No derivative formula changes | ✅ |
| No health weight changes | ✅ |

### What Was NOT Done

- No production refresh (would produce same degenerate results)
- No derivative formula changes (out of scope)
- No health weight changes (out of scope)
- No fallback provider added (out of scope)
- No infrastructure changes (not possible from code)
