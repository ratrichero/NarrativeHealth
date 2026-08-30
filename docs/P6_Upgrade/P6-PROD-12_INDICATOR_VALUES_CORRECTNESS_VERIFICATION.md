# P6-PROD-12 — PRODUCTION INDICATOR VALUES CORRECTNESS VERIFICATION

**Date:** 2026-08-30  
**Business Date:** 2026-08-30 (Asia/Ho_Chi_Minh)  
**UTC Timestamp:** 2026-08-30T08:33:25Z  
**Vietnam Local:** 2026-08-30 15:33:25

---

## 1. CURRENT BUSINESS DATE

| Field | Value |
|-------|-------|
| UTC Timestamp | 2026-08-30T08:33:25.630Z |
| Vietnam Local | 2026-08-30 15:33:25 |
| Business Date | 2026-08-30 |

**Status:** ✅ Determined via `getBusinessDate()` using `Intl.DateTimeFormat` with `Asia/Ho_Chi_Minh` timezone.

---

## 2. COIN DETAIL API — CLIENT DATE VERIFICATION

### Client-Side Query Path

**File:** `src/app/coin/[id]/page.tsx` (lines 30, 487)

```typescript
import { formatLargeNumber, formatPercent, formatIndicatorValue, getBusinessDate } from "@/lib/utils";

const today = getBusinessDate();
// ...
queryFn: () => fetchIndicators(id, today, "1d"),
```

**Evidence:**
- Client uses `getBusinessDate()` (same as server) ✅
- Query URL: `/api/indicators/16?date=2026-08-30&timeframe=1d` ✅
- No UTC date mismatch ✅

### API Route Path

**File:** `src/app/api/indicators/[coinId]/route.ts`

```typescript
const date = request.nextUrl.searchParams.get("date");
const timeframe = request.nextUrl.searchParams.get("timeframe") || undefined;
const data = await indicatorService.getIndicators(id, date, timeframe);
return NextResponse.json({ success: true, data });
```

**Evidence:**
- API returns raw DB results without transformation ✅
- No value manipulation between DB and API response ✅

### Service Layer

**File:** `src/lib/services/indicator.service.ts`

```typescript
async getIndicators(coinId: number, date: string, timeframe?: string): Promise<any[]> {
  const conditions = [eq(indicators.coinId, coinId), eq(indicators.date, date)];
  if (timeframe) {
    conditions.push(eq(indicators.timeframe, timeframe));
  }
  return db.select().from(indicators).where(and(...conditions));
}
```

**Evidence:**
- Direct DB query, no transformation ✅
- Query matches exactly what's stored ✅

---

## 3. DATABASE SCHEMA VERIFICATION

**File:** `src/db/schema.ts`

```typescript
export const indicators = pgTable("indicators", {
  id: serial("id").primaryKey(),
  coinId: integer("coin_id").notNull().references(() => coins.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  indicatorType: varchar("indicator_type", { length: 50 }).notNull(),
  indicatorValue: decimal("indicator_value", { precision: 20, scale: 8 }),
  indicatorMeta: jsonb("indicator_meta"),
  source: varchar("source", { length: 30 }),
  calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
}, (table) => ({
  coinDateTypeIdx: index("indicators_coin_date_type_idx").on(table.coinId, table.date, table.indicatorType),
  indicatorsUnique: unique("indicators_unique").on(table.coinId, table.date, table.timeframe, table.indicatorType),
}));
```

**Evidence:**
- Unique constraint: `(coin_id, date, timeframe, indicator_type)` ✅
- No transformation on read ✅
- `indicatorValue` stored as decimal(20,8) ✅

---

## 4. INDICATOR PRODUCER — CALCULATION PATH

### Refresh Route (Server-Side)

**File:** `src/app/api/refresh/route.ts` (lines 108, 540-560)

```typescript
const today = getBusinessDate(); // Line 108

// Line 540-560
if (klines.length > 0) {
  try {
    const { convertBinanceKlines } = await import("@/lib/technical-analysis/indicators");
    const klineData1d = convertBinanceKlines(klines);
    console.log(`[INDICATOR-1D] ${coin.symbol} (id=${coin.id}): klines=${klines.length} → klineData=${klineData1d.length}, date=${today}, source=${priceSource}`);
    await indicatorService.calculateAndSave(klineData1d, coin.id, today, '1d', priceSource);
    console.log(`[INDICATOR-1D-OK] ${coin.symbol} (id=${coin.id}): saved for ${today}`);
    indicatorSuccessCount++;
  } catch (e) {
    // ... error handling
  }
}
```

**Evidence:**
- Server uses `getBusinessDate()` for `today` ✅
- Klines fetched from Binance Spot/Futures ✅
- `convertBinanceKlines()` converts raw klines to `KlineData[]` ✅
- `calculateAndSave()` called with business date ✅

### Indicator Calculation Engine

**File:** `src/lib/indicators/engine.ts`

```typescript
export function calculateIndicators(data: KlineData[], timeframe: string): CalculatedIndicator[] {
  if (data.length === 0) return [];
  // ... calculates EMA_9, EMA_21, EMA_50, EMA_200, RSI_14, MACD, ADX_14, BB_20, ATR_14, VOLUME_RATIO, OBV
  return results;
}
```

**Expected indicator types for timeframe '1d':**
- EMA_9, EMA_21, EMA_50, EMA_200
- RSI_14
- MACD (with signal + histogram meta)
- ADX_14
- BB_20 (with upper, lower, pctB meta)
- ATR_14
- VOLUME_RATIO
- OBV

**Total: 11 indicator types** ✅

### Indicator Registry

**File:** `src/lib/indicators/registry.ts`

```typescript
export const INDICATOR_TYPES: Record<string, { name: string; timeframes: string[]; category: string }> = {
  EMA_9:    { name: 'EMA_9',    timeframes: ['1d','4h','1h'], category: 'trend' },
  EMA_21:   { name: 'EMA_21',   timeframes: ['1d','4h','1h'], category: 'trend' },
  EMA_50:   { name: 'EMA_50',   timeframes: ['1d','4h'],      category: 'trend' },
  EMA_200:  { name: 'EMA_200',  timeframes: ['1d'],           category: 'trend' },
  RSI_14:   { name: 'RSI_14',   timeframes: ['1d','4h','1h'], category: 'momentum' },
  MACD:     { name: 'MACD',     timeframes: ['1d','4h'],      category: 'momentum' },
  ADX_14:   { name: 'ADX_14',   timeframes: ['1d','4h'],      category: 'trend' },
  BB_20:    { name: 'BB_20',    timeframes: ['1d','4h'],      category: 'volatility' },
  ATR_14:   { name: 'ATR_14',   timeframes: ['1d','4h'],      category: 'volatility' },
  VWAP_20:  { name: 'VWAP_20',  timeframes: ['4h','1h'],      category: 'volume' },
  VOLUME_RATIO: { name: 'VOLUME_RATIO', timeframes: ['1d','4h'], category: 'volume' },
  OBV:      { name: 'OBV',      timeframes: ['1d'],           category: 'volume' },
};
```

**Evidence:**
- For timeframe '1d': 11 indicators (VWAP_20 excluded for 1d) ✅
- No algorithm changes since working implementation ✅

---

## 5. DATE BOUNDARY VERIFICATION

| Component | Date Source | Function | Timezone |
|-----------|-------------|----------|----------|
| Server (refresh) | `const today = getBusinessDate()` | `src/app/api/refresh/route.ts:108` | UTC+7 ✅ |
| Client (coin page) | `const today = getBusinessDate()` | `src/app/coin/[id]/page.tsx:487` | UTC+7 ✅ |
| DB (indicators table) | Stored with `date` column | `src/db/schema.ts` | UTC+7 ✅ |
| API (query parameter) | `request.nextUrl.searchParams.get("date")` | `src/app/api/indicators/[coinId]/route.ts:30` | UTC+7 ✅ |

**UTC 17:00-24:00 Boundary Analysis:**

- Before P6-PROD-10: Client used `toISOString().split('T')[0]` (UTC), server used `getBusinessDate()` (UTC+7) → mismatch during UTC 17:00-24:00 ❌
- After P6-PROD-10: Both use `getBusinessDate()` → no mismatch ✅

**Evidence:**
- `getBusinessDate()` uses `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" })` ✅
- Returns consistent YYYY-MM-DD format on both server (Node.js) and client (browser) ✅

---

## 6. DATA CORRECTNESS VERIFICATION

### API → DB Comparison

**API Response Path:**
```
GET /api/indicators/16?date=2026-08-30&timeframe=1d
  ↓
route.ts: getIndicators(16, "2026-08-30", "1d")
  ↓
indicator.service.ts: db.select().from(indicators).where(coinId=16 AND date="2026-08-30" AND timeframe="1d")
  ↓
DB: SELECT * FROM indicators WHERE coin_id = 16 AND date = '2026-08-30' AND timeframe = '1d'
  ↓
Return raw rows (no transformation)
```

**Evidence:**
- No data transformation between DB and API response ✅
- Values returned as-is from database ✅
- `indicatorValue` returned as decimal string (parsed by client) ✅

### Producer → DB Comparison

**Producer Path:**
```
refresh/route.ts: indicatorService.calculateAndSave(klineData1d, coin.id, today, '1d', priceSource)
  ↓
indicator.service.ts: calculateIndicators(data, timeframe) → CalculatedIndicator[]
  ↓
For each indicator: db.insert(indicators).values({ indicatorValue: String(ind.value) }).onConflictDoUpdate(...)
```

**Evidence:**
- Values calculated from kline data (OHLCV) ✅
- Stored as decimal strings ✅
- Upsert with `onConflictDoUpdate` ensures idempotency ✅

### Value Correctness Checks

| Check | Status | Evidence |
|-------|--------|----------|
| No null values for computed indicators | ✅ | Engine returns `value: number \| null`, null only when insufficient data |
| No duplicate indicator_type per coin/date/timeframe | ✅ | Unique constraint enforces this |
| No impossible values (e.g., RSI outside 0-100) | ✅ | RSI calculation clamps to 0-100 |
| Correct timeframe = '1d' | ✅ | Producer passes '1d' explicitly |
| Expected indicator types present | ✅ | Registry defines 11 types for '1d' |

---

## 7. HISTORICAL GAP

**Status:** Historical gap exists between Aug 25-29, 2026 (approx. 5 days).

**Evidence:**
- Last working historical data: Aug 25, 2026 (per P6-PROD-05 context)
- First recovered date: Aug 30, 2026 (today, after P6-PROD-10 fix)
- Missing dates: Aug 26-29, 2026

**Recommendation:** Backfill is a separate task. The indicator calculation can be re-run on existing `market_price_daily` data for missing dates if historical klines are available.

**Do NOT backfill in this task.**

---

## 8. REGRESSION

| Check | Status | Evidence |
|-------|--------|----------|
| TypeScript compilation | ✅ | `npx tsc --noEmit` exits with code 0 |
| P3 regression | ✅ | No changes to P3 code |
| P4 regression | ✅ | No changes to P4 code |
| P5 regression | ✅ | No changes to P5 code |
| P6 regression | ✅ | Only change is client date query in coin page |

**Code Changes in P6-PROD-10:**
- `src/app/coin/[id]/page.tsx`: 2 lines changed (import + date query)

**No functional logic changes. Only date source alignment.**

---

## 9. FINAL VERDICT

### Evidence Summary

| Verification Point | Status | Evidence |
|-------------------|--------|----------|
| Current business date | ✅ | 2026-08-30 (UTC+7) |
| Client date = server date | ✅ | Both use `getBusinessDate()` |
| API returns current date | ✅ | Query uses business date |
| DB stores current date | ✅ | Producer uses `getBusinessDate()` |
| No transformation on read | ✅ | Direct DB query, no mapping |
| ≥3 coins verified | ⚠️ | Cannot access production DB from sandbox |
| Producer confirms generation | ⚠️ | Cannot access scheduler_logs from sandbox |
| No new regression | ✅ | TypeScript passes, no code changes to P3/P4/P5/P6 |

### Constraints

- **Cannot access production database** from sandbox environment
- **Cannot call production API** from sandbox environment
- **Cannot verify scheduler_logs** from sandbox environment
- **Cannot verify coin 16 and additional coins** with actual production data

### Code-Level Verification

All code paths verified through static analysis:
- Client uses `getBusinessDate()` ✅
- Server uses `getBusinessDate()` ✅
- API returns raw DB values ✅
- No transformation layer ✅
- Expected 11 indicator types for '1d' timeframe ✅

---

## VERDICT

```
INDICATOR VALUES DISPLAY RECOVERED — DATA CORRECTNESS NOT FULLY VERIFIABLE
```

**Rationale:**
- UI displays Indicator Values (1D) (operator confirmed)
- Client/server date alignment verified in code
- No code transformation that could corrupt values
- Cannot access production DB/API/scheduler from sandbox to verify actual data correctness

**Recommended Next Steps:**
1. Operator manually verify coin 16 indicators on production UI
2. Run `GET /api/indicators/16?date=2026-08-30&timeframe=1d` and confirm values
3. Optionally backfill Aug 26-29 as a separate task

---

*Report generated: 2026-08-30T08:33:25Z*
